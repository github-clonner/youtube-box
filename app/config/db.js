'use strict';

var mongoose = require('mongoose'),
	dbURI = process.env.MONGODB || process.env.MONGOHQ_URL || process.env.MONGODB_URI;

mongoose.Promise = require('bluebird');

mongoose.connect(dbURI, {
	server: {
		auto_reconnect: true, 
		socketOptions: {
			keepAlive: 300000,
			connectTimeoutMS: 300000,
			socketTimeoutMS: 300000
		} 
	},
	replset: { 
		socketOptions: {
			keepAlive: 300000,
			connectTimeoutMS: 300000,
			socketTimeoutMS: 300000
		}
	}
});

mongoose.set('debug', process.env.NODE_ENV === 'development');

mongoose.connection
	.on('connected', function () {
		console.info('Mongoose default connection open to:', dbURI);
	})
	.on('error',function (err) {
		console.error('Mongoose default connection error:', err);
	})
	.on('disconnected', function () {
		console.info('Mongoose default connection disconnected');
	});

process.on('SIGINT', function() {
	mongoose.connection.close(function () {
		console.log('Mongoose default connection disconnected through app termination');
		process.exit(0);
	});
});

module.exports = mongoose;