import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch profile data for a specific user ID
 */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching profile:', error);
  }
  return data;
}

/**
 * Upload an avatar image file to Supabase Storage 'avatars' bucket
 */
export async function uploadAvatar(file, userId) {
  const fileExt = file.name.split('.').pop();
  const filePath = `${userId}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Update user profile details (username, bio, avatarUrl, theme)
 */
export async function updateProfile({ userId, username, bio, avatarUrl, theme }) {
  const updates = {
    id: userId,
    username,
    bio,
    theme,
    updated_at: new Date().toISOString()
  };

  if (avatarUrl !== undefined) {
    updates.avatar_url = avatarUrl;
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(updates)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Also sync theme / avatar into auth user metadata for fast retrieval
  await supabase.auth.updateUser({
    data: { username, avatar_url: avatarUrl || updates.avatar_url, theme, bio }
  });

  return data;
}

/**
 * Delete a message by ID (RLS enforces that user owns the message)
 */
export async function deleteMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);

  if (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
  return true;
}
