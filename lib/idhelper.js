"use strict";

/**
 * Manages logical operation on hexadecimal strings (parsing, comparing, etc...).
 * Anything that would require use of BigInteger.
 * @exports idhelper
 */
let bigInt = require('big-integer');

module.exports.getBigInt = getBigInt;
module.exports.parseBigInt10 = parseBigInt10;
module.exports.withinMax = withinMax;
module.exports.closest = closest;
module.exports.furthestDistance = furthestDistance;
module.exports.distance = distance;
module.exports.directedDistance = directedDistance;
module.exports.contains = contains;
module.exports.convertToIdString = convertToIdString;
module.exports.getIdealVertical = getIdealVertical;
module.exports.remove = remove;
module.exports.goodEnough = goodEnough;
module.exports.niceIdArray = niceIdArray;
module.exports.shortName = shortName;
module.exports.shortArray = shortArray;
module.exports.MAX = bigInt('10000000000000000000000000000000000000000000000000000000000000000', 16);
module.exports.HALF_MAX = bigInt('8000000000000000000000000000000000000000000000000000000000000000', 16);

let MAX = module.exports.MAX;
let HALF_MAX = module.exports.HALF_MAX;
let idcache = {};

/**
 * Caches the big integer representation of the hex id string and clones an instance
 * for the caller to use.
 */
function getBigInt(id) {
	if (!idcache[id]) {
		idcache[id] = bigInt(id, 16);
	}
	return idcache[id];
}

function parseBigInt10(value) {
	return bigInt(value, 10);
}

function withinMax(bn) {
	return bn.compareTo(MAX) <= 0;
}

/**
 * Find the closest (numerically, wrapping around from 0 to the maximum id size)
 * value in the list of ids.
 */
function closest(id, ids) {
	let closest = ids[0];
	let distanceBigInt = MAX;
	for (let i = 0; i < ids.length; i++) {
		let candidateDistanceBigInt = distance(id, ids[i]);
		if (candidateDistanceBigInt.compareTo(distanceBigInt) < 0) {
			distanceBigInt = candidateDistanceBigInt;
			closest = ids[i];
		}
	}
	return closest;
}

/**
 * Find the distance to the furthest id in the set of ids.
 */
function furthestDistance(id, ids) {
	let closest = ids[0];
	let distanceBigInt = BigInteger.ZERO;
	for (let i = 0; i < ids.length; i++) {
		let candidateDistanceBigInt = distance(id, ids[i]);
		if (candidateDistanceBigInt.compareTo(distanceBigInt) > 0) {
			distanceBigInt = candidateDistanceBigInt;
			closest = ids[i];
		}
	}
	return distanceBigInt;
}

/**
 * Get the shortest distance between id1 and id2 (wrapping around from 0 to the maximum id size).
 */
function distance(id1, id2) {
	let id1BigInt = getBigInt(id1);
	let id2BigInt = getBigInt(id2);
	let distanceBigInt = id2BigInt.subtract(id1BigInt).abs();
	if (HALF_MAX.compareTo(distanceBigInt) < 0) {
		distanceBigInt = MAX.subtract(distanceBigInt);
	}
	return distanceBigInt;
}

/**
 * Get the directed distance from id1 to id2 (order is important).	Wraps
 * from 0 to the maximum id size.
 */
function directedDistance(id1, id2) {
	let id1BigInt = getBigInt(id1);
	let id2BigInt = getBigInt(id2);
	let distanceBigInt = id2BigInt.subtract(id1BigInt);
	if (bigInt.zero.compareTo(distanceBigInt) > 0) {
		distanceBigInt = MAX.add(distanceBigInt);
	}
	return distanceBigInt;
}

// TODO: just use indexOf?
function contains(array, value) {
	let found = false;
	for (let index = 0; index < array.length; index++) {
		if (array[index] == value) {
			found = true;
			break;
		}
		
	}
	return found;
}

function convertToIdString(bn) {
	let result = bn.toString(16);
	while (result.length < HALF_MAX.length) {
		result = '0' + result;
	}
	idcache[result] = bn;
	return result;
}

function getIdealVertical(id, level) {
	let idealVertical = getBigInt(id);
	let offset = HALF_MAX;
	for (let index = 0; index <= level; index++) {
		idealVertical = idealVertical.add(offset);
		if (idealVertical.compareTo(MAX) > 0) {
			idealVertical = idealVertical.subtract(MAX);
		}
		// Shifting right divides by 2.
		offset = offset.shiftRight(1);
	}
	return convertToIdString(idealVertical);
}

function remove(id, ids) {
	let index = ids.indexOf(id);
	if (index >= 0) {
		ids.splice(index, 1);
	}
}

function goodEnough(id, candidate, level) {
	let distanceBI = distance(getIdealVertical(id, level), candidate);
	let maxDistanceBI = HALF_MAX.shiftRight(level + 2);
	return distanceBI.compareTo(maxDistanceBI) < 0;
}

function niceIdArray(idArray) {
	let result = '';
	for (let i = 0; i < idArray.length; i++) {
		if (result.length > 0) {
			result += ', ';
		}
		result += shortName(idArray[i]);
	}
	return '[' + result + ']';
}

function shortName(longName, ellipsis = true) {
	if (!longName) {
		return 'MISSING';
	}
	return longName.substring(0,6) + (ellipsis ? '...' : '');
}

function shortArray(ids) {
	return ids.map(id => shortName(id, false));
}
