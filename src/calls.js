// 1:1 voice/video calls. WebRTC media is peer-to-peer; signaling goes over
// Supabase Realtime broadcast on a per-user inbox channel `calls:<userId>`.

const ICE = (() => {
  try { const j = import.meta.env.VITE_ICE_SERVERS; if (j) return JSON.parse(j) } catch { /* fall through */ }
  return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
})()

const RING_MS = 45000

export class Calls {
  constructor(sb, me, onChange, onNotice) {
    this.sb = sb; this.me = me; this.onChange = onChange; this.onNotice = onNotice
    this.peerChans = new Map()
    this.reset(true)
  }

  reset(silent) {
    this.pc?.close()
    this.local?.getTracks().forEach((t) => t.stop())
    clearTimeout(this.ringTimer)
    this.pc = null; this.local = null; this.remote = null; this.offer = null; this.pendingIce = []
    this.s = { phase: 'idle', peer: null, video: false, muted: false, camOff: false, startedAt: null }
    if (!silent) this.emit()
  }

  emit() { this.onChange({ ...this.s, local: this.local, remote: this.remote }) }

  init() {
    this.inbox = this.sb.channel(`calls:${this.me.id}`)
      .on('broadcast', { event: 'sig' }, ({ payload }) => this.onSignal(payload))
      .subscribe()
  }

  peerChannel(id) {
    if (!this.peerChans.has(id)) {
      this.peerChans.set(id, new Promise((res) => {
        const ch = this.sb.channel(`calls:${id}`)
        ch.subscribe((st) => { if (st === 'SUBSCRIBED') res(ch) })
      }))
    }
    return this.peerChans.get(id)
  }

  async send(toId, payload) {
    const ch = await this.peerChannel(toId)
    const name = this.me.display_name || this.me.username
    return ch.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: { id: this.me.id, name } } })
  }

  makePc() {
    const pc = new RTCPeerConnection({ iceServers: ICE })
    this.pc = pc
    pc.ontrack = (e) => { this.remote = e.streams[0]; this.emit() }
    pc.onicecandidate = (e) => { if (e.candidate && this.s.peer) this.send(this.s.peer.id, { type: 'ice', candidate: e.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected' && !this.s.startedAt) {
        clearTimeout(this.ringTimer)
        this.s.phase = 'connected'; this.s.startedAt = Date.now(); this.emit()
      } else if (st === 'failed') this.end('Call failed. A TURN server may be needed on this network.')
    }
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local))
    return pc
  }

  async media(video) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true, video }) }
    catch { this.onNotice(`Allow microphone${video ? ' and camera' : ''} access to use calls.`); return null }
  }

  async start(peer, video) {
    if (this.s.phase !== 'idle') return
    const stream = await this.media(video)
    if (!stream) return
    this.local = stream
    this.s = { ...this.s, phase: 'calling', peer, video }
    this.emit()
    const pc = this.makePc()
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await this.send(peer.id, { type: 'offer', sdp: offer.sdp, video })
    this.ringTimer = setTimeout(() => this.end('No answer'), RING_MS)
  }

  async accept() {
    if (this.s.phase !== 'incoming') return
    clearTimeout(this.ringTimer)
    const stream = await this.media(this.s.video)
    if (!stream) return this.decline()
    this.local = stream
    const pc = this.makePc()
    await pc.setRemoteDescription({ type: 'offer', sdp: this.offer.sdp })
    await this.flushIce()
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await this.send(this.s.peer.id, { type: 'answer', sdp: answer.sdp })
    this.s.phase = 'connecting'; this.emit()
  }

  decline() {
    if (this.s.peer) this.send(this.s.peer.id, { type: 'reject' })
    this.reset()
  }

  hangup() { this.end('Call ended') }

  end(notice) {
    if (this.s.peer) this.send(this.s.peer.id, { type: 'hangup' })
    this.reset()
    if (notice) this.onNotice(notice)
  }

  endRemote(notice) { this.reset(); if (notice) this.onNotice(notice) }

  async flushIce() {
    for (const c of this.pendingIce) await this.pc.addIceCandidate(c).catch(() => {})
    this.pendingIce = []
  }

  async onSignal(p) {
    const { type, from } = p || {}
    if (!from?.id) return
    if (type === 'offer') {
      if (this.s.phase !== 'idle') return this.send(from.id, { type: 'busy' })
      this.offer = p
      this.s = { ...this.s, phase: 'incoming', peer: from, video: !!p.video }
      this.ringTimer = setTimeout(() => this.endRemote('Missed call'), RING_MS)
      return this.emit()
    }
    if (from.id !== this.s.peer?.id) return
    if (type === 'answer' && this.pc) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp })
      await this.flushIce()
    } else if (type === 'ice') {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(p.candidate).catch(() => {})
      else this.pendingIce.push(p.candidate)
    } else if (type === 'hangup') this.endRemote('Call ended')
    else if (type === 'reject') this.endRemote('Call declined')
    else if (type === 'busy') this.endRemote('They are on another call')
  }

  toggleMute() {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled))
    this.s.muted = !this.s.muted; this.emit()
  }

  toggleCam() {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !t.enabled))
    this.s.camOff = !this.s.camOff; this.emit()
  }
}
