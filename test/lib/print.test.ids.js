"use strict"

let LocalID = require('../lib/localid').LocalID;

let ids = [];

for (let i = 0; i < 25; i++) {
	ids.push(new LocalID(true));
}

let idMap = {};
ids.sort((a,b) => a.id.localeCompare(b.id)).forEach(a => idMap[a.id.substring(0, 5)] = a);

console.log(JSON.stringify(ids, null, '\t'));
console.log('// id: ' + ids.map(a => a.id.substring(0,5)).sort().join(', '));