'use strict';

var redis = require('redis'),
	Cacheman = require('cacheman-redis');
	
var client = redis.createClient({
	url: process.env.REDIS_URL || process.env.REDISCLOUD_URL,
	no_ready_check: true
});

client.on('error', function (err) {
	console.error(err);
});

module.exports = client;
module.exports.cache = new Cacheman(client);