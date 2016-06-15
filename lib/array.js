'use strict';

module.exports.add = add;
module.exports.remove = remove;

function add(array, o) {
	let index = array.indexOf(o);
	if (index < 0) {
		array.push(o);
	}
}

function remove(array, o) {
	let index = array.indexOf(o);
	if (index > -1) {
		array.splice(index, 1);
	}
}