import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lead, User, WhatsAppMessage } from '../models/index.js';
import { starterOfChat, keepChatWithSender } from './chatStarter.js';

const q = (rows) => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => rows });
const users = [{ _id: 'u1', name: 'Emad', role: 'sales_rep' }, { _id: 'u2', name: 'Gone', isActive: false }];
User.findById = (id) => q(users.find((u) => u._id === String(id)) || null);

test('the CRM login that sent our opening message started the chat', async () => {
    WhatsAppMessage.find = () => q([{ direction: 'outbound', sentBy: 'u1', occurredAt: new Date(1) }]);
    assert.equal((await starterOfChat('971')).name, 'Emad');
});

test('a chat from the Business app phone, or one the customer opened, has no known starter', async () => {
    WhatsAppMessage.find = () => q([{ direction: 'outbound', text: 'This is Emad from PurpleBox', occurredAt: new Date(1) }]);
    assert.equal(await starterOfChat('971'), null);
    WhatsAppMessage.find = () => q([{ direction: 'inbound', occurredAt: new Date(1) }, { direction: 'outbound', sentBy: 'u1', occurredAt: new Date(2) }]);
    assert.equal(await starterOfChat('971'), null);
});

test('an inactive user never becomes the owner', async () => {
    WhatsAppMessage.find = () => q([{ direction: 'outbound', sentBy: 'u2', occurredAt: new Date(1) }]);
    assert.equal(await starterOfChat('971'), null);
    assert.equal(await keepChatWithSender({ phoneNormalized: '971', userId: 'u2' }), null);
});

test('messaging an unowned lead from the CRM makes it yours', async () => {
    let update;
    Lead.findOne = () => q({ _id: 'L1', owner: null, status: 'new' });
    Lead.updateOne = async (filter, u) => { update = { filter, u }; return { modifiedCount: 1 }; };
    assert.ok(await keepChatWithSender({ phoneNormalized: '971', userId: 'u1' }));
    assert.equal(update.filter.owner, null);
    assert.equal(update.u.$set.owner, 'u1');
    assert.equal(update.u.$set.autoAssigned, false);
});

test('a lead someone already owns, or a closed one, is left alone', async () => {
    let touched = false;
    Lead.updateOne = async () => { touched = true; return { modifiedCount: 1 }; };
    Lead.findOne = () => q({ _id: 'L1', owner: 'u9', status: 'new' });
    assert.equal(await keepChatWithSender({ phoneNormalized: '971', userId: 'u1' }), null);
    Lead.findOne = () => q({ _id: 'L1', owner: null, status: 'won' });
    assert.equal(await keepChatWithSender({ phoneNormalized: '971', userId: 'u1' }), null);
    assert.equal(touched, false);
});
