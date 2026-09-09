import test from 'node:test';
import assert from 'node:assert/strict';
import { videoNeedsHosting, WHATSAPP_VIDEO_NATIVE_LIMIT } from './videoThumbnail.js';

test('a video at or under the native limit sends natively; over it, it hosts', () => {
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: 'x', mediaSizeBytes: WHATSAPP_VIDEO_NATIVE_LIMIT }), false);
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: 'x', mediaSizeBytes: WHATSAPP_VIDEO_NATIVE_LIMIT + 1 }), true);
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: 'x', mediaSizeBytes: 1024 }), false);
});

test('an unknown size (0, missing, or predating the field) is treated as needing hosting', () => {
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: 'x', mediaSizeBytes: 0 }), true);
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: 'x' }), true);
});

test('anything that is not an uploaded video never needs hosting', () => {
    assert.equal(videoNeedsHosting({ mediaKind: 'image', mediaUrl: 'x', mediaSizeBytes: 999e9 }), false);
    assert.equal(videoNeedsHosting({ mediaKind: 'video', mediaUrl: '', mediaSizeBytes: 999e9 }), false);
    assert.equal(videoNeedsHosting({ mediaKind: '', mediaUrl: '', mediaSizeBytes: 0 }), false);
});
