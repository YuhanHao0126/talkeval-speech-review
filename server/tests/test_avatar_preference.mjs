import assert from 'node:assert/strict';
import { resolveAvatarPreference, readAvatarPreferences, rememberAvatarPreference } from '../static/avatar-preference.js';

const dataset = { video_url: '/static/sample.mp4', avatar_preference: 'female' };
assert.equal(resolveAvatarPreference(dataset, 'male', {}).character, 'male');
assert.equal(resolveAvatarPreference(dataset, 'auto', { lastCharacter: 'male' }).character, 'female');
assert.equal(resolveAvatarPreference({ video_url: '/video-a' }, 'auto', { byVideo: { '/video-a': 'female' }, lastCharacter: 'male' }).source, 'saved_video');
assert.equal(resolveAvatarPreference({}, 'auto', { lastCharacter: 'female' }).character, 'female');
assert.equal(resolveAvatarPreference({ speaker_gender: 'female', avatar_preference: '../../other.glb' }, 'auto', {}).character, 'male');
assert.equal(resolveAvatarPreference(null, 'auto', {}).source, 'default');
const stored = new Map();
const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
assert.equal(rememberAvatarPreference(storage, dataset, 'female'), true);
assert.equal(readAvatarPreferences(storage).byVideo['/static/sample.mp4'], 'female');
assert.equal(rememberAvatarPreference(storage, dataset, 'unknown'), false);
const unavailable = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } };
assert.deepEqual(readAvatarPreferences(unavailable), {});
assert.equal(rememberAvatarPreference(unavailable, dataset, 'male'), false);
console.log('Avatar preference precedence, invalid values, persistence and unavailable storage passed.');
