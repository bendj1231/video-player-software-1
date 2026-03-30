import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ktiqqcyjrrgsfxthrqpf.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aXFxY3lqcnJnc2Z4dGhycXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NTE1NzcsImV4cCI6MjA5MDIyNzU3N30.h5MObRPpOGSy4c7zncROJiklDPnAPyqnH3EyGXP3vxM';

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function uploadVideoToCloud(folderId: string, videoId: string, file: Blob, name: string) {
  const path = `${folderId}/${videoId}_${name}.zip`;
  const { data, error } = await supabase.storage
    .from('video-zips')
    .upload(path, file, {
      contentType: 'application/zip',
      upsert: true,
    });
  
  if (error) throw error;
  return data;
}

export async function downloadVideoFromCloud(folderId: string, videoId: string, name: string): Promise<Blob> {
  const path = `${folderId}/${videoId}_${name}.zip`;
  const { data, error } = await supabase.storage
    .from('video-zips')
    .download(path);
  
  if (error) throw error;
  return data;
}

export async function listCloudVideos(folderId: string) {
  const { data, error } = await supabase.storage
    .from('video-zips')
    .list(folderId);
  
  if (error) throw error;
  return data || [];
}

export async function deleteVideoFromCloud(folderId: string, videoId: string, name: string) {
  const path = `${folderId}/${videoId}_${name}.zip`;
  const { error } = await supabase.storage
    .from('video-zips')
    .remove([path]);
  
  if (error) throw error;
}

export function getCloudVideoUrl(folderId: string, videoId: string, name: string): string {
  const path = `${folderId}/${videoId}_${name}.zip`;
  const { data } = supabase.storage.from('video-zips').getPublicUrl(path);
  return data.publicUrl;
}
