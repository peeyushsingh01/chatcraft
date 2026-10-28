import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error && error.code !== 'PGRST116') console.error('Error fetching profile:', error);
  return data;
}

export async function uploadAvatar(file, userId) {
  const fileExt = file.name.split('.').pop();
  const filePath = `${userId}/${Date.now()}.${fileExt}`;
  
  const { error } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
  if (error) throw error;
  
  return supabase.storage.from('avatars').getPublicUrl(filePath).data.publicUrl;
}

export async function updateProfile({ userId, username, bio, avatarUrl, theme }) {
  const updates = { id: userId, username, bio, theme, updated_at: new Date().toISOString() };
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

  const { data, error } = await supabase.from('profiles').upsert(updates).select().single();
  if (error) throw error;

  await supabase.auth.updateUser({ data: { username, avatar_url: avatarUrl || updates.avatar_url, theme, bio }});
  return data;
}

export async function deleteMessage(messageId) {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw error;
  return true;
}
