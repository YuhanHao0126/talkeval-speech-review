const isCharacter = value => value === 'male' || value === 'female';

export function resolveAvatarPreference(dataset, selection, saved = {}) {
  if (isCharacter(selection)) return { character: selection, source: 'manual', description: '本次手动选择' };
  if (isCharacter(dataset?.avatar_preference)) return { character: dataset.avatar_preference, source: 'profile', description: '按演讲资料中的角色偏好' };
  const videoChoice = saved.byVideo?.[dataset?.video_url];
  if (isCharacter(videoChoice)) return { character: videoChoice, source: 'saved_video', description: '沿用此视频已保存的角色' };
  if (isCharacter(saved.lastCharacter)) return { character: saved.lastCharacter, source: 'saved_default', description: '沿用上次选择的角色' };
  return { character: 'male', source: 'default', description: '未设置角色偏好，使用默认人物' };
}

export function readAvatarPreferences(storage) {
  try {
    const parsed = JSON.parse(storage.getItem('talkeval-avatar-preferences') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function rememberAvatarPreference(storage, dataset, character) {
  if (!isCharacter(character)) return false;
  const current = readAvatarPreferences(storage);
  const byVideo = current.byVideo && typeof current.byVideo === 'object' ? current.byVideo : {};
  const next = { lastCharacter: character, byVideo: { ...byVideo } };
  if (dataset?.video_url) next.byVideo[dataset.video_url] = character;
  try { storage.setItem('talkeval-avatar-preferences', JSON.stringify(next)); return true; }
  catch { return false; }
}
