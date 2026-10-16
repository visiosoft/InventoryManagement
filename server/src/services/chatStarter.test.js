import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introducedName, userByFirstName } from './chatStarter.js';

test('reads the name a rep introduces themselves by', () => {
    assert.equal(introducedName('Hi, this is Emad from the Purplebox'), 'emad');
    assert.equal(introducedName('Hello This is Mahmoud from PurpleBox'), 'mahmoud');
    assert.equal(introducedName('this is Randa from Purple Box storage'), 'randa');
    assert.equal(introducedName('My name is Emad'), 'emad');
    assert.equal(introducedName('Kevin here, regarding storage'), 'kevin');
});

test('no introduction, no name', () => {
    assert.equal(introducedName('I am following up on your enquiry'), '');
    assert.equal(introducedName('Your unit is ready'), '');
    assert.equal(introducedName(''), '');
});

test('a first name points to one active user, preferring sales reps', () => {
    const users = [
        { _id: '1', name: 'Emad Ali', role: 'sales_rep' },
        { _id: '3', name: 'Sara A', role: 'admin' },
        { _id: '4', name: 'Sara B', role: 'sales_rep' },
        { _id: '5', name: 'Old Rep', role: 'sales_rep', isActive: false },
    ];
    assert.equal(userByFirstName(users, 'emad')._id, '1');
    assert.equal(userByFirstName(users, 'sara')._id, '4');
    assert.equal(userByFirstName(users, 'old'), null);
    assert.equal(userByFirstName(users, 'zed'), null);
});
