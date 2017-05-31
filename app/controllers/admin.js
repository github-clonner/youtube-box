'use strict';

var router = require('express').Router(),
	Promise = require('bluebird'),
	helpers = require('config/helpers'),
	Cleanup = require('jobs/cleanup'),
	User = require('models/user'),
	Channel = require('models/channel'),
	Video = require('models/video'),
	Subscription = require('models/subscription');

router.all('*', helpers.isAdmin);


var mostWatchedChannels = function(total) {
	
	return Subscription.aggregate([
		{ $project : { channels : 1, _id : -1 } }, //select fields
		{ $unwind: '$channels' }, // set subdocument as primary field
		{ $group: {
			_id: '$channels',
			count: { $sum: 1  }
		}},
		//{ $match : { count : { $gt : 1} } },
		{ $sort : { count : -1 } },
		{ $limit : total }
	])
	.exec()
	.then(function (channels) {
		return Channel.populate(channels, {path: '_id'});
	});
};

var mostWatchedVideos = function(total) {
	
	return Subscription.aggregate([
		{ $project : { videos : 1, _id : -1 } }, //select fields
		{ $unwind: '$videos' }, // set subdocument as primary field
		{ $match : { 'videos.watched' : { $ne : null } } },
		{ $group: {
			_id: '$videos._id',
			count: { $sum: 1  }
		}},
		{ $match : { count : { $gt : 1} } },
		{ $sort : { count : -1 } },
		{ $limit : total }
	])
	.exec()
	.then(function (videos) {
		console.log(videos);
		return Video.populate(videos, {path: '_id'});
	})
	.then(function (videos) {
		console.log(videos);
		return Channel.populate(videos, {path: '_id.channel'});
	});
};

//http://stackoverflow.com/questions/7811163/how-to-query-for-documents-where-array-size-is-greater-than-one-1-in-mongodb/15224544#15224544
var mostActiveUsers = function(total) {
	
	return Subscription
			.find({ 'watched.1': {$exists: true}})
			.limit(total)
			.sort('-watched')
			.populate('user')
			.lean();
};


router.get('/', function(req, res, next) {
	
	return Promise.props({
		users: User.count(),
		channels: Channel.count(),
		videos: Video.count(),
		lastUsers: User.find().sort('-_id').limit(1),
		mostWatchedChannels: mostWatchedChannels(5),
		mostWatchedVideos: mostWatchedVideos(5),
		mostActiveUsers: mostActiveUsers(5)
	})
	.then(function( result ) {
		
		result.title = 'Dashboard';
		
		res.render('admin', result);
	})
	.catch(function(e) {
		return next(e);
	});
	
});

router.get('/cleanup/videos', function(req, res){
	
	Cleanup.removeOldVideos().then(function(){
		
		res.json('done');
		
	});
	
});

router.get('/cleanup/user/:id', function(req, res){
	
	Cleanup.deleteUser(req.params.id).then(function(){
		
		res.json('done');
		
	});
	
});

router.get('/cleanup/subscriptions', function(req, res){
	
	Cleanup.removeVideos().then(function(){
		
		res.json('done');
		
	});
	
});

router.get('/cleanup/channels', function(req, res){
	
	Cleanup.removeChannels().then(function(){
		
		res.json('done');
		
	});
	
});

module.exports = router;