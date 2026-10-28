/**
 * Interactive Emoji Picker Module
 * Exports setupEmojiPicker and initEmojiPicker to satisfy build requirements
 */
export function setupEmojiPicker(onEmojiSelect) {
  const emojiBtn = document.getElementById('emoji-btn');
  const wrapper = document.getElementById('emoji-picker-wrapper');
  const messageInput = document.getElementById('message-input');

  if (!emojiBtn || !wrapper) return;

  const EMOJI_LIST = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
    '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
    '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
    '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
    '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
    '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
    '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
    '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '😵', '🤠', '😎',
    '👏', '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟',
    '🤘', '👌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚',
    '🖐', '🖖', '👋', '🤙', '💪', '✍️', '🙏', '🔥', '❤️', '💖',
    '✨', '🎉', '🚀', '💯', '⭐', '💩', '🎈', '🎯', '⚡', '☕'
  ];

  wrapper.innerHTML = `
    <div class="p-3 theme-card bg-gray-900 border border-gray-700 rounded-2xl grid grid-cols-8 gap-1.5 shadow-2xl max-h-48 overflow-y-auto w-64 sm:w-80">
      ${EMOJI_LIST.map(emoji => `
        <button type="button" class="emoji-item p-1.5 text-lg hover:bg-gray-800 rounded-lg transition transform hover:scale-125 flex items-center justify-center">
          ${emoji}
        </button>
      `).join('')}
    </div>
  `;

  emojiBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wrapper.classList.toggle('hidden');
  });

  wrapper.addEventListener('click', (e) => {
    const target = e.target.closest('.emoji-item');
    if (target) {
      const emoji = target.textContent.trim();
      if (messageInput) {
        messageInput.value += emoji;
        messageInput.focus();
      }
      if (typeof onEmojiSelect === 'function') {
        onEmojiSelect(emoji);
      }
      wrapper.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!emojiBtn.contains(e.target) && !wrapper.contains(e.target)) {
      wrapper.classList.add('hidden');
    }
  });
}

export const initEmojiPicker = setupEmojiPicker;
export default setupEmojiPicker;

