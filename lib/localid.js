"use strict";

let cryptoJs = require('crypto-js');
let NodeRSA = require('node-rsa');
let storage = require('./storage');

class LocalID {
	constructor(random, copyFrom, json) {
		this.random = random;
		if (random) {
			makeIdentityStore(this, 'Tester');
		} else if (copyFrom) {
			this.identityStore = copyFrom.identityStore;
			this.key = copyFrom.key;
		} else if (json) {
			this.identityStore = JSON.parse(json);
			this.key = new NodeRSA();
			this.key.importKey(this.identityStore.exportedKey);
		} else {
			let identityStoreJSON = storage.getItem('identityStore2');
			if (identityStoreJSON) {
				this.identityStore = JSON.parse(identityStoreJSON);
				this.key = new NodeRSA();
				this.key.importKey(this.identityStore.exportedKey);
			} else {
				makeIdentityStore(this, 'Anonymous');
				save(this.identityStore);
			}
		}
		this.id = this.identityStore.id;
		this.publicName = this.identityStore.publicName;
		this.instanceId = '' + new Date().getTime();
	}

	savePublicName(publicName) {
		this.identityStore.publicName = this.publicName = publicName;
		save(this.identityStore);
	}

	print() {
		console.log(JSON.stringify(this.identityStore));
	}

	toJSON() {
		return JSON.stringify(this.identityStore);
	}
}

function makeIdentityStore(localid, publicName) {
	localid.key = new NodeRSA({b: 512});
	localid.identityStore = {};
	localid.identityStore.id = cryptoJs.SHA256(localid.key.exportKey('pkcs8-public-pem')).toString();
	localid.identityStore.exportedKey = localid.key.exportKey();
	localid.identityStore.publicName = publicName;
}

function save(identityStore) {
	storage.setItem('identityStore2', JSON.stringify(identityStore));
}

module.exports.LocalID = LocalID;
