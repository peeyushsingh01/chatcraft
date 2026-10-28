import './style.css'
import { supabase, configured } from './supabase.js'
import { EMOJI, QUICK_REACTIONS } from './emoji.js'
import { Calls } from './calls.js'
import { $, $$, esc, isOnlyEmoji, fmtTime, fmtStamp, avatar, icon, toast, beep, sound, setSound, compressImage } from './util.js'

const state = {
  me: null,
  convs: new Map(),
  activeId: null,
  messages: [],
  hasMore: false,
  reactions: new Map(),
  online: new Set(),
  filter: '',
}
let calls = null
const PAGE = 60

/* ───────────── helpers ───────────── */
const nameOf = (p) => p?.display_name || p?.username || 'Someone'
const peerOf = (c) => c.members.find((m) => m.user_id !== state.me.id)
const convTitle = (c) => (c.is_group ? c.name || 'Group' : nameOf(peerOf(c)?.profile))
const profileOf = (id) => {
  for (const c of state.convs.values()) { const m = c.members.find((x) => x.user_id === id); if (m) return m.profile }
  return null
}
const activeConv = () => state.convs.get(state.activeId)
const isNear = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 140

/* ───────────── static icons ───────────── */
function paintIcons() {
  const map = {
    '#btn-accent': 'palette', '#btn-new': 'compose', '#btn-logout': 'logout', '#search-icon': 'search',
    '#btn-back': 'back', '#btn-voice': 'phone', '#btn-video': 'video', '#btn-emoji': 'smile',
    '#btn-attach': 'image', '#btn-mic': 'mic', '#btn-send': 'send', '#new-close': 'x', '#lightbox-close': 'x',
  }
  for (const [sel, name] of Object.entries(map)) $(sel).innerHTML = icon(name, sel === '#search-icon' ? 'w-4 h-4' : 'w-5 h-5')
  paintSound()
}
const paintSound = () => { $('#btn-sound').innerHTML = icon(sound.on ? 'volume-2' : 'volume-x') }

/* ───────────── auth ───────────── */
let mode = 'signin'
function setMode(m) {
  mode = m
  const up = m === 'signup'
  $('#auth-username-wrap').classList.toggle('hidden', !up)
  $('#auth-sub').textContent = up ? 'Create your account' : 'Sign in to continue'
  $('#auth-submit').textContent = up ? 'Create account' : 'Sign in'
  $('#auth-toggle').textContent = up ? 'Already have an account? Sign in' : 'New here? Create an account'
  $('#auth-password').autocomplete = up ? 'new-password' : 'current-password'
  authMsg('')
}
function authMsg(text, ok = false) {
  const el = $('#auth-msg')
  el.textContent = text
  el.classList.toggle('hidden', !text)
  el.classList.toggle('text-emerald-400', ok)
  el.classList.toggle('text-rose-400', !ok)
}
$('#auth-toggle').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'))
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = $('#auth-email').value.trim()
  const password = $('#auth-password').value
  const btn = $('#auth-submit')
  authMsg('')
  if (!email || password.length < 6) return authMsg('Enter an email and a password of at least 6 characters.')
  btn.disabled = true
  try {
    if (mode === 'signup') {
      const username = $('#auth-username').value.trim().toLowerCase()
      if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('Username must be 3–20 letters, numbers or underscores.')
      const { data: free, error: e1 } = await supabase.rpc('username_available', { p_username: username })
      if (e1) throw e1
      if (!free) throw new Error('That username is taken.')
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })
      if (error) throw error
      if (!data.session) return authMsg('Check your email to confirm your account, then sign in.', true)
      await startApp(data.user)
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      await startApp(data.user)
    }
  } catch (err) {
    authMsg(err.message || 'Something went wrong.')
  } finally {
    btn.disabled = false
  }
})
$('#btn-logout').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload() })

/* ───────────── boot ───────────── */
async function boot() {
  if (!configured) return $('#setup').classList.remove('hidden')
  const accent = localStorage.getItem('cc-accent'); if (accent) document.documentElement.dataset.accent = accent
  const { data: { session } } = await supabase.auth.getSession()
  supabase.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && state.me) location.reload() })
  if (session) await startApp(session.user)
  else $('#auth').classList.remove('hidden')
}

async function startApp(user) {
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error || !profile) {
    $('#auth').classList.remove('hidden')
    return authMsg('Your profile is missing. Did you run supabase/schema.sql?')
  }
  state.me = profile
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden')
  $('#me-avatar').innerHTML = avatar(nameOf(profile), 'w-9 h-9')
  $('#me-name').textContent = nameOf(profile)
  await loadConversations()
  subscribeRealtime()
  calls = new Calls(supabase, profile, renderCall, toast)
  calls.init()
}

/* ───────────── conversations ───────────── */
async function loadConversations() {
  const { data: mine, error } = await supabase
    .from('conversation_members')
    .select('conversation_id, conversations(id,is_group,name,created_at)')
    .eq('user_id', state.me.id)
  if (error) return toast(error.message)
  const ids = mine.map((r) => r.conversation_id)
  const convs = new Map()
  if (ids.length) {
    const [{ data: members }, { data: sums }] = await Promise.all([
      supabase.from('conversation_members').select('conversation_id,user_id,last_read_at,profiles(id,username,display_name)').in('conversation_id', ids),
      supabase.rpc('conversation_summaries'),
    ])
    for (const r of mine) convs.set(r.conversations.id, { ...r.conversations, members: [], last: null, unread: 0 })
    for (const m of members || []) convs.get(m.conversation_id)?.members.push({ user_id: m.user_id, last_read_at: m.last_read_at, profile: m.profiles })
    for (const s of sums || []) {
      const c = convs.get(s.cid); if (!c) continue
      c.unread = Number(s.unread)
      c.last = s.last_at ? { body: s.last_body, kind: s.last_kind, created_at: s.last_at, sender_id: s.last_sender } : null
    }
  }
  state.convs = convs
  if (state.activeId && convs.has(state.activeId)) convs.get(state.activeId).unread = 0
  renderSidebar()
}

function preview(c) {
  const l = c.last
  if (!l) return 'No messages yet'
  const text = l.kind === 'image' ? '📷 Photo' : l.kind === 'audio' ? '🎤 Voice message' : l.body
  return (l.sender_id === state.me.id ? 'You: ' : '') + text
}

function renderSidebar() {
  const q = state.filter.toLowerCase()
  const list = [...state.convs.values()]
    .filter((c) => convTitle(c).toLowerCase().includes(q))
    .sort((a, b) => new Date(b.last?.created_at || b.created_at) - new Date(a.last?.created_at || a.created_at))
  $('#chat-list').innerHTML = list.length
    ? list.map(chatRow).join('')
    : `<p class="p-4 text-sm text-slate-400">${state.convs.size ? 'No chats match your search.' : 'No chats yet. Use the pencil button to start one.'}</p>`
  const total = [...state.convs.values()].reduce((n, c) => n + c.unread, 0)
  document.title = total ? `(${total}) ChatCraft` : 'ChatCraft'
}

function chatRow(c) {
  const title = convTitle(c)
  const online = !c.is_group && state.online.has(peerOf(c)?.user_id)
  return `<button data-conv="${esc(c.id)}" class="chat-row${c.id === state.activeId ? ' active' : ''}">
    <div class="relative">${avatar(title)}${online ? '<span class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-950" aria-label="online"></span>' : ''}</div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between gap-2"><h4 class="font-semibold text-sm truncate">${esc(title)}</h4><span class="text-xs text-slate-400 shrink-0">${c.last ? fmtStamp(c.last.created_at) : ''}</span></div>
      <p class="text-sm text-slate-400 truncate">${esc(preview(c))}</p>
    </div>
    ${c.unread ? `<span class="px-2 py-0.5 rounded-full bg-accent-600 text-white text-xs font-bold">${c.unread}</span>` : ''}
  </button>`
}

$('#chat-list').addEventListener('click', (e) => { const b = e.target.closest('[data-conv]'); if (b) openConv(b.dataset.conv) })
$('#search').addEventListener('input', (e) => { state.filter = e.target.value.trim(); renderSidebar() })

function renderHeader() {
  const c = activeConv(); if (!c) return
  const title = convTitle(c)
  $('#hdr-avatar').innerHTML = avatar(title, 'w-9 h-9')
  $('#hdr-title').textContent = title
  $('#hdr-status').textContent = c.is_group
    ? c.members.map((m) => nameOf(m.profile)).join(', ')
    : state.online.has(peerOf(c)?.user_id) ? 'Online' : 'Offline'
  $('#hdr-calls').classList.toggle('hidden', c.is_group)
}

/* ───────────── open conversation ───────────── */
async function openConv(id) {
  state.activeId = id
  state.messages = []; state.reactions = new Map()
  document.body.dataset.view = 'chat'
  $('#empty').classList.add('hidden')
  const panel = $('#chat-panel'); panel.classList.remove('hidden'); panel.classList.add('flex')
  renderHeader(); renderSidebar()
  $('#messages').innerHTML = '<p class="text-sm text-slate-400 text-center">Loading…</p>'
  $('#typing').innerHTML = ''
  subscribeTyping(id)
  await fetchMessages(id)
  if (state.activeId !== id) return
  renderMessages()
  markRead()
  $('#composer-input').focus({ preventScroll: true })
}

async function fetchMessages(id, before) {
  let q = supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) return toast(error.message)
  if (state.activeId !== id) return
  const batch = (data || []).reverse()
  state.hasMore = batch.length === PAGE
  state.messages = before ? [...batch, ...state.messages] : batch
  const mids = batch.map((m) => m.id)
  if (mids.length) {
    const { data: rx } = await supabase.from('reactions').select('*').in('message_id', mids)
    for (const r of rx || []) addReaction(r)
  }
}

$('#btn-back').addEventListener('click', () => {
  state.activeId = null
  document.body.dataset.view = 'list'
  $('#chat-panel').classList.add('hidden'); $('#chat-panel').classList.remove('flex')
  $('#empty').classList.remove('hidden')
  renderSidebar()
})

/* ───────────── message rendering ───────────── */
function tickHtml(createdAt, c) {
  if (c.is_group) return icon('check', 'w-3.5 h-3.5')
  const other = peerOf(c)
  const seen = other && new Date(other.last_read_at) >= new Date(createdAt)
  return seen ? icon('check-check', 'w-3.5 h-3.5 text-accent-300') : icon('check', 'w-3.5 h-3.5')
}

function reactionsHtml(mid) {
  const groups = {}
  for (const r of state.reactions.get(mid) || []) (groups[r.emoji] ||= []).push(r.user_id)
  return Object.entries(groups).map(([e, users]) =>
    `<button data-toggle-react="${esc(mid)}" data-emoji="${esc(e)}" class="rx${users.includes(state.me.id) ? ' mine' : ''}" aria-label="${esc(e)} reaction, ${users.length}">${esc(e)} ${users.length}</button>`).join('')
}

function msgHtml(m, c, fresh) {
  const mine = m.sender_id === state.me.id
  const who = nameOf(profileOf(m.sender_id))
  const jumbo = m.kind === 'text' && isOnlyEmoji(m.body)
  let inner
  if (m.kind === 'image') inner = `<button data-lightbox="${esc(m.media_url)}" class="block" aria-label="Open photo"><img src="${esc(m.media_url)}" alt="Photo from ${esc(who)}" loading="lazy" class="rounded-xl max-h-72 max-w-full object-cover"></button>`
  else if (m.kind === 'audio') inner = `<audio controls preload="none" src="${esc(m.media_url)}" class="h-10 max-w-full" aria-label="Voice message from ${esc(who)}"></audio>`
  else inner = `<p class="whitespace-pre-wrap break-words leading-relaxed">${esc(m.body)}</p>`
  const bubble = jumbo
    ? `<div class="text-5xl py-1 select-none${fresh ? ' animate-jumbo' : ''}">${esc(m.body)}</div>`
    : `<div class="max-w-[85%] md:max-w-[65%] rounded-2xl px-3.5 py-2.5 text-sm shadow-md ${mine ? 'bg-accent-600 text-white rounded-br-md' : 'msg-bubble-incoming text-slate-100 border rounded-bl-md'}">${inner}</div>`
  return `<div class="msg group flex flex-col ${mine ? 'items-end' : 'items-start'}" data-id="${esc(m.id)}">
    ${c.is_group && !mine ? `<span class="text-xs font-medium text-accent-300 mb-1 px-1">${esc(who)}</span>` : ''}
    ${bubble}
    <div class="flex items-center flex-wrap gap-1.5 mt-1 px-1 text-xs text-slate-400">
      <span>${fmtTime(m.created_at)}</span>
      ${mine ? `<span class="tick" data-ts="${esc(m.created_at)}">${tickHtml(m.created_at, c)}</span>` : ''}
      <span class="reactions flex gap-1">${reactionsHtml(m.id)}</span>
      ${mine ? `<button data-delete-msg="${esc(m.id)}" aria-label="Delete message" title="Delete message" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 p-0.5 rounded hover:text-rose-400">${icon('x', 'w-4 h-4')}</button>` : ''}
      <button data-react="${esc(m.id)}" aria-label="Add reaction" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 p-0.5 rounded hover:text-white">${icon('smile', 'w-4 h-4')}</button>
    </div>
  </div>`
}

function renderMessages(keepScroll = false) {
  const box = $('#messages'), c = activeConv()
  const prevH = box.scrollHeight, prevTop = box.scrollTop
  box.innerHTML =
    (state.hasMore ? '<button id="load-older" class="btn-ghost mx-auto block !py-1.5 text-xs">Load earlier messages</button>' : '') +
    (state.messages.length ? state.messages.map((m) => msgHtml(m, c, false)).join('') : '<p class="empty-hint text-sm text-slate-400 text-center mt-8">No messages yet. Say hello 👋</p>')
  box.scrollTop = keepScroll ? box.scrollHeight - prevH + prevTop : box.scrollHeight
}

function appendMessage(m) {
  if (state.messages.some((x) => x.id === m.id)) return
  const c = activeConv(), box = $('#messages')
  const stick = isNear(box) || m.sender_id === state.me.id
  state.messages.push(m)
  box.querySelector('.empty-hint')?.remove()
  box.insertAdjacentHTML('beforeend', msgHtml(m, c, true))
  if (stick) box.scrollTop = box.scrollHeight
}

$('#messages').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delete-msg]')
  if (del) {
    const mid = del.dataset.deleteMsg
    const msg = state.messages.find((m) => m.id === mid)
    if (!msg || msg.sender_id !== state.me.id) return
    if (!confirm('Delete this message for everyone?')) return
    del.disabled = true
    const { error } = await supabase.from('messages').delete().eq('id', mid).eq('sender_id', state.me.id)
    if (error) { del.disabled = false; return toast('Could not delete message: ' + error.message) }
    removeMessage(mid)
    return
  }
  if (e.target.closest('#load-older')) {
    await fetchMessages(state.activeId, state.messages[0]?.created_at)
    renderMessages(true)
  }
})

function removeMessage(mid) {
  const msg = state.messages.find((m) => m.id === mid)
  state.messages = state.messages.filter((m) => m.id !== mid)
  state.reactions.delete(mid)
  const c = msg && state.convs.get(msg.conversation_id)
  if (c && c.last?.created_at === msg.created_at) loadConversations()
  if (msg?.conversation_id === state.activeId) renderMessages()
}

/* ───────────── reactions ───────────── */
function addReaction(r) {
  const list = state.reactions.get(r.message_id) || []
  if (!list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) list.push({ user_id: r.user_id, emoji: r.emoji })
  state.reactions.set(r.message_id, list)
}
function removeReaction(r) {
  state.reactions.set(r.message_id, (state.reactions.get(r.message_id) || []).filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)))
}
function refreshReactions(mid) {
  const el = $(`.msg[data-id="${CSS.escape(mid)}"] .reactions`)
  if (el) el.innerHTML = reactionsHtml(mid)
}
async function toggleReaction(mid, emoji) {
  const row = { message_id: mid, user_id: state.me.id, emoji }
  const had = (state.reactions.get(mid) || []).some((x) => x.user_id === row.user_id && x.emoji === emoji)
  if (had) removeReaction(row); else addReaction(row)
  refreshReactions(mid)
  const { error } = had
    ? await supabase.from('reactions').delete().match(row)
    : await supabase.from('reactions').insert(row)
  if (error) { if (had) addReaction(row); else removeReaction(row); refreshReactions(mid); toast('Could not update reaction.') }
}

let reactTarget = null
function openReactPop(btn, mid) {
  reactTarget = mid
  const pop = $('#react-pop')
  pop.innerHTML = QUICK_REACTIONS.map((e) => `<button data-pick-react="${e}" class="text-lg hover:scale-125 transition-transform" aria-label="React ${e}">${e}</button>`).join('')
  pop.classList.remove('hidden')
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth
  pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`
  pop.style.left = `${Math.min(Math.max(8, r.left - w / 2), window.innerWidth - w - 8)}px`
}

/* ───────────── sending ───────────── */
function autosize() {
  const ta = $('#composer-input'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 128) + 'px'
}
async function insertMessage(row) {
  const { data, error } = await supabase.from('messages').insert({ ...row, sender_id: state.me.id }).select().single()
  if (error) throw error
  onNewMessage(data)
  beep('send')
}
async function sendText() {
  const ta = $('#composer-input'), body = ta.value.trim()
  if (!body || !state.activeId) return
  ta.value = ''; autosize()
  try { await insertMessage({ conversation_id: state.activeId, kind: 'text', body }) }
  catch (err) { ta.value = body; autosize(); toast('Message not sent: ' + err.message) }
}
async function sendMedia(blob, kind, ext, type) {
  const cid = state.activeId
  toast(kind === 'image' ? 'Uploading photo…' : 'Sending voice message…')
  const path = `${cid}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('chat-media').upload(path, blob, { contentType: type, cacheControl: '31536000' })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path)
  await insertMessage({ conversation_id: cid, kind, media_url: publicUrl })
}

$('#btn-send').addEventListener('click', sendText)
const ta = $('#composer-input')
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText() }
})
ta.addEventListener('input', () => { autosize(); sendTyping() })

$('#btn-attach').addEventListener('click', () => $('#file-input').click())
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''
  if (!f || !state.activeId) return
  if (!f.type.startsWith('image/')) return toast('Choose an image file.')
  try { await sendMedia(await compressImage(f), 'image', 'jpg', 'image/jpeg') }
  catch (err) { toast('Photo not sent: ' + err.message) }
})

/* ───────────── voice notes ───────────── */
let rec = null, recTimer = null
async function startRecording() {
  if (!state.activeId) return
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Voice messages are not supported in this browser.')
  let stream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
  catch { return toast('Allow microphone access to record.') }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
  const chunks = []
  rec = { mr, stream, send: false, started: Date.now(), cid: state.activeId }
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  mr.onstop = async () => {
    stream.getTracks
