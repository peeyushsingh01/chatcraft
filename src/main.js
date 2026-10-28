import { supabase, getProfile, uploadAvatar, updateProfile, deleteMessage } from './supabase.js';
import './calls.js';
import './emoji.js';

let currentUser = null;
let currentProfile = null;

// Available Color Themes
const THEMES = [
  { id: 'emerald', name: 'Emerald Green', desc: 'Modern Social Messenger', preview: '#059669' },
  { id: 'violet',  name: 'Violet Purple',  desc: 'Team Workspace UI',        preview: '#7C3AED' },
  { id: 'indigo',  name: 'Indigo Blue',    desc: 'AI Assistant Canvas',      preview: '#4F46E5' },
  { id: 'rose',    name: 'Rose Pink',      desc: 'Customer Support Widget',  preview: '#E11D48' },
  { id: 'amber',   name: 'Amber Orange',   desc: 'Vibrant Dark Mobile UI',   preview: '#F59E0B' }
];

// Instantly changes CSS variables based on your selection
function applyTheme(themeId) {
  const validTheme = THEMES.some(t => t.id === themeId) ? themeId : 'emerald';
  document.documentElement.setAttribute('data-theme', validTheme);
  localStorage.setItem('chatcraft_theme', validTheme);
}

// ==========================================================================
// GLOBAL EVENT DELEGATION (Bulletproof for SPAs & Custom Login Screens)
// ==========================================================================

document.addEventListener('click', (e) => {
  // 1. Open Profile Modal
  if (e.target.closest('#edit-profile-btn')) {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.remove('hidden');
  }
  
  // 2. Close Profile Modal
  if (e.target.closest('#close-profile-btn') || e.target.closest('#cancel-profile-btn')) {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.add('hidden');
  }
});

document.addEventListener('submit', (e) => {
  // 3. Handle Chat Form Submit
  if (e.target.id === 'chat-form') {
    e.preventDefault();
    const messageInput = document.getElementById('message-input');
    if (messageInput?.value) {
      handleSendMessage(messageInput.value);
      messageInput.value = '';
    }
  }
});


// ==========================================================================
// PROFILE MODAL RENDERING & LOGIC
// ==========================================================================

function renderProfileModal() {
  const existing = document.getElementById('profile-modal');
  if (existing) existing.remove();

  const activeTheme = currentProfile?.theme || localStorage.getItem('chatcraft_theme') || 'emerald';

  const modalHtml = `
    <div id="profile-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop hidden p-4">
      <div class="theme-card border rounded-2xl w-full max-w-lg p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button id="close-profile-btn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
        
        <h2 class="text-2xl font-bold mb-4">Edit Profile & Appearance</h2>

        <div class="flex flex-col items-center mb-6">
          <div class="relative group w-24 h-24 mb-3">
            <img id="avatar-preview" 
                 src="${currentProfile?.avatar_url || 'https://via.placeholder.com/96?text=User'}" 
                 class="w-24 h-24 rounded-full object-cover border-2 border-emerald-500 shadow" />
            <label for="avatar-file-input" class="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 cursor-pointer transition">
              <span class="text-xs font-semibold">Change</span>
            </label>
            <input type="file" id="avatar-file-input" accept="image/*" class="hidden" />
          </div>
          <span class="text-xs text-gray-400">Click photo to upload new picture</span>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1">Display Name</label>
            <input type="text" id="profile-username" value="${currentProfile?.username || currentUser?.email?.split('@')[0] || ''}" 
                   class="w-full px-3 py-2 rounded-lg border theme-card focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>

          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1">Bio</label>
            <textarea id="profile-bio" rows="3" placeholder="Tell everyone something about yourself..."
                      class="w-full px-3 py-2 rounded-lg border theme-card focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm">${currentProfile?.bio || ''}</textarea>
          </div>

          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-2">Color Theme</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2" id="theme-selector-list">
              ${THEMES.map(theme => `
                <button type="button" data-theme-id="${theme.id}" 
                        class="theme-option-btn border p-2.5 rounded-xl flex items-center gap-3 text-left hover:border-gray-400 transition ${activeTheme === theme.id ? 'ring-2 ring-offset-1 ring-emerald-500' : ''}">
                  <span class="w-5 h-5 rounded-full flex-shrink-0" style="background-color: ${theme.preview}"></span>
                  <div class="overflow-hidden">
                    <p class="text-xs font-bold truncate">${theme.name}</p>
                    <p class="text-[10px] text-gray-400 truncate">${theme.desc}</p>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <button id="cancel-profile-btn" class="px-4 py-2 rounded-lg text-sm border hover:bg-gray-100/10">Cancel</button>
          <button id="save-profile-btn" class="px-4 py-2 rounded-lg text-sm font-semibold theme-btn-primary">Save Changes</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  attachProfileModalEvents();
}

function attachProfileModalEvents() {
  let selectedFile = null;
  let selectedTheme = currentProfile?.theme || localStorage.getItem('chatcraft_theme') || 'emerald';

  document.getElementById('avatar-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      document.getElementById('avatar-preview').src = URL.createObjectURL(file);
    }
  });

  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTheme = btn.dataset.themeId;
      applyTheme(selectedTheme); // Preview theme dynamically
      document.querySelectorAll('.theme-option-btn').forEach(b => b.classList.remove('ring-2', 'ring-offset-1', 'ring-emerald-500'));
      btn.classList.add('ring-2', 'ring-offset-1', 'ring-emerald-500');
    });
  });

  document.getElementById('save-profile-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    if (!currentUser) return alert('You must be logged in.');

    try {
      btn.disabled = true;
      btn.textContent = 'Saving...';

      let avatarUrl = currentProfile?.avatar_url;
      if (selectedFile) {
        avatarUrl = await uploadAvatar(selectedFile, currentUser.id);
      }

      currentProfile = await updateProfile({
        userId: currentUser.id,
        username: document.getElementById('profile-username').value.trim(),
        bio: document.getElementById('profile-bio').value.trim(),
        avatarUrl,
        theme: selectedTheme
      });

      applyTheme(selectedTheme);
      document.getElementById('profile-modal')?.classList.add('hidden');
      
      // Update UI avatars without reloading
      document.querySelectorAll('.msg-avatar-self').forEach(img => img.src = avatarUrl || img.src);
    } catch (err) {
      alert('Update failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

// ==========================================================================
// CHAT LOGIC
// ==========================================================================

function createMessageElement(msg) {
  const isOwner = currentUser && msg.user_id === currentUser.id;
  const container = document.createElement('div');
  container.className = `flex gap-3 mb-4 message-container ${isOwner ? 'flex-row-reverse' : 'flex-row'}`;
  container.dataset.msgId = msg.id;

  const avatar = msg.avatar_url || 'https://via.placeholder.com/36?text=U';
  const ownerAvatarClass = isOwner ? 'msg-avatar-self' : '';

  container.innerHTML = `
    <img src="${avatar}" class="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-200 ${ownerAvatarClass}" title="${msg.username}" />
    <div class="flex flex-col max-w-[70%] ${isOwner ? 'items-end' : 'items-start'}">
      <span class="text-[11px] text-gray-400 mb-1 px-1">${msg.username}</span>
      <div class="relative group">
        <div class="p-3 rounded-2xl text-sm ${isOwner ? 'msg-user rounded-tr-none' : 'msg-incoming rounded-tl-none'}">
          ${msg.content}
        </div>
        ${isOwner ? `
          <button data-delete-id="${msg.id}" 
                  class="delete-btn absolute -top-2 -left-8 bg-red-500 text-white p-1 rounded-full text-xs shadow hover:bg-red-600 transition" 
                  title="Delete message">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  if (isOwner) {
    container.querySelector('[data-delete-id]')?.addEventListener('click', async () => {
      if (confirm('Delete this message?')) {
        try {
          await deleteMessage(msg.id);
          container.remove();
        } catch (e) {
          alert('Could not delete: ' + e.message);
        }
      }
    });
  }
  return container;
}

async function loadMessages() {
  const chatWindow = document.getElementById('chat-window');
  if (!chatWindow) return;

  const { data: messages, error } = await supabase.from('messages').select('*').order('created_at', { ascending: true });
  if (error) return console.error('Error fetching messages:', error);

  chatWindow.innerHTML = '';
  messages.forEach(msg => chatWindow.appendChild(createMessageElement(msg)));
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function handleSendMessage(content) {
  if (!content.trim() || !currentUser) return;
  await supabase.from('messages').insert({
    user_id: currentUser.id,
    username: currentProfile?.username || currentUser.email?.split('@')[0] || 'User',
    avatar_url: currentProfile?.avatar_url || '',
    content: content.trim()
  });
}

function subscribeRealtime() {
  const chatWindow = document.getElementById('chat-window');
  supabase.channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (chatWindow) {
        chatWindow.appendChild(createMessageElement(payload.new));
        chatWindow.scrollTop = chatWindow.scrollHeight;
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, payload => {
      document.querySelector(`[data-msg-id="${payload.old.id}"]`)?.remove();
    })
    .subscribe();
}

// ==========================================================================
// AUTHENTICATION LISTENER
// ==========================================================================

// This instantly detects when you successfully log in using your custom UI
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    currentProfile = await getProfile(currentUser.id);
    
    if (currentProfile?.theme) {
      applyTheme(currentProfile.theme);
    }
    
    renderProfileModal();
    loadMessages();
  } else {
    currentUser = null;
    currentProfile = null;
  }
});

// App Initialization
function init() {
  applyTheme(localStorage.getItem('chatcraft_theme') || 'emerald');
  renderProfileModal(); // Mounts the empty modal to the DOM immediately
  subscribeRealtime();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
