var request = require('request-promise'),
	Promise = require('bluebird'),
	moment = require('moment'),
	refresh = require('passport-oauth2-refresh'),
	User = require('../models/user'),
	Subscription = require('../models/subscription'),
	Channel = require('../models/channel'),
	Video = require('../models/video');
	
//require('request-debug')(request);
Promise.promisifyAll(refresh);

var refreshAccessToken = exports.refreshAccessToken = function(user, nextPageToken){
	
	if( moment.utc().subtract(55, 'minutes').isBefore( user.youtube.accessTokenUpdate ) ) {
		return Promise.resolve(user);
	}
	
	if( ! user.youtube.refreshToken ) {
		return Promise.reject(new Error('refreshToken is not defined') );
	}
	
	return refresh
		.requestNewAccessTokenAsync('youtube', user.youtube.refreshToken)
		.then(function(result){
			console.log( 'accessToken', result[0] );
			
			return User.findByIdAndUpdate(user._id, {
				'youtube.accessToken': result[0],
				'youtube.accessTokenUpdate': new Date().toISOString()
			});
		})
		.catch(function(err) {
			console.error(err);
		});
};

exports.userSubscriptions = function(){
	
	return User.find('_id youtube').lean()
		.then(function(users){
			return users;
		})
		.each(function(user){
			
			return refreshAccessToken(user)
				.then(function(user){
					return subscriptions(user);
				}).catch(function(err) {
					console.error(err);
				});
				
		})
		.catch(function(err) {
			console.error(err);
		});
};

var subscriptions = exports.subscriptions = function(user, nextPageToken){
	
	return api('subscriptions', {
		mine: true,
		part: 'snippet',
		fields: 'nextPageToken,items(snippet)',
		pageToken: nextPageToken
	}, subscriptions, user)
	.each(function(item){
			
		return Channel.findByIdAndUpdate(item.snippet.resourceId.channelId, {
			title: item.snippet.title,
			description: item.snippet.description,
			thumbnail: item.snippet.thumbnails.default.url
		}, { upsert: true });
		
	})
	.then(function(items){
		
		if( items && items.length ){
			var channelsId = items.map(function(item){
				return item.snippet.resourceId.channelId;
			});
			
			Subscription.findOneAndUpdate({'user': user._id}, nextPageToken ? {
				$addToSet: { channels: { $each: channelsId } }
			} : {
				channels: channelsId
			}, { upsert: true }, function(err){
				if(err) console.error( err );
			});
		}
		
		console.log('channels', items && items.length);
		
	})
	.catch(function(err) {
		console.error(err);
	});
	
};

exports.channels = function(){
	
	return Channel.find().select('_id updatedDate').lean()
		.then(function(channels){
			return channels;
		})
		.each(function(channel){
			activities(channel);
		})
		.catch(function(err) {
			console.error(err);
		});
};

var activities = exports.activities = function(channel, nextPageToken){
	
	return api('activities', {
		channelId: channel._id,
		part: 'snippet,contentDetails',
		fields: 'nextPageToken,items(snippet,contentDetails)',
		publishedAfter: channel.updatedDate || moment.utc().subtract(1, 'month').toDate(),
		pageToken: nextPageToken
	}, activities, channel)
	.filter(function(item){
		return item.snippet.type === 'upload';
	})
	.each(function(item){
		
		Video.findByIdAndUpdate(item.contentDetails.upload.videoId, {
			title: item.snippet.title,
			description: item.snippet.description,
			published: item.snippet.publishedAt,
			channel: item.snippet.channelId,
		}, { upsert: true }, function(err, video){
			if (err) console.error( err );
		});
		
	})
	.then(function(items){
		
		Channel.findByIdAndUpdate(channel._id, {
			updatedDate: Date.now()
		}, function(err){
			if (err) console.error( err );
		});
			
		if( items && items.length ){
			console.log('activities', items[0].snippet.channelTitle, items.length);
			
			videos(items.map(function(item){
				return item.contentDetails.upload.videoId;
			}).join(','));
		}
	})
	.catch(function(err) {
		console.error(err);
	});
};

var videos = exports.videos = function(videoId, nextPageToken){
	
	var durationExp = /(?:(\d+)H)?(?:(\d+)M)?(\d+)S/;
	
	api('videos', {
		id: videoId,
		part: 'contentDetails,statistics',
		fields: 'nextPageToken,items(id,contentDetails,statistics)',
		pageToken: nextPageToken
	}, videos, videoId)
	.each(function(item){
		
		/* "contentDetails": {
			"duration": "PT1H41M23S",
			"dimension": "2d",
			"definition": "hd",
			"caption": "false",
			"licensedContent": true
		},
		"statistics": {
			"viewCount": "75196",
			"likeCount": "1837",
			"dislikeCount": "59",
			"favoriteCount": "0",
			"commentCount": "61"
		 } */
		 
		var result, duration = 0;
		
		if( (result = durationExp.exec(item.contentDetails.duration) ) ) {
			duration = ((parseInt(result[1] || 0, 10) * 60) + parseInt(result[2] || 0, 10) ) * 60 + parseInt(result[3] || 0, 10);
		}
		
		Video.findByIdAndUpdate(item.id, {
			duration: duration,
			views: item.statistics.viewCount,
			likes: item.statistics.likeCount,
			dislikes: item.statistics.dislikeCount,
			definition: item.contentDetails.definition
		}, { upsert: true }, function(err, video){
			if (err) console.error( err );
		});
		
	})
	.catch(function(err) {
		console.error(err);
	});
};

var api = function(method, filter, callback, callbackArgs){
	
	//console.time('request');
	
	filter.prettyPrint = false;
	filter.maxResults = 50;
	
	var params = {
		url: 'https://www.googleapis.com/youtube/v3/' + method,
		qs: filter,
		json: true,
		gzip: true
	};
	
	if ( filter.mine && callbackArgs.youtube ) {
		params.auth = {
			bearer: callbackArgs.youtube.accessToken
		};
	} else {
		filter.key = process.env.YOUTUBE_API_KEY;
	}
	
	return request(params).then(function(data){
		//console.timeEnd('request');
		
		if( data.nextPageToken && callback ) {
			//console.log('callback', method, filter);
			callback(callbackArgs, data.nextPageToken);
		}
		
		return data.items;
	})
	.catch(function(e){
		console.error('request', e.error);
		
		return [];
	});
};

exports.getUserEmail = function(user){
	request({
		url: 'https://www.googleapis.com/plus/v1/people/me',
		json: true,
		gzip: true,
		auth:{
			bearer: user.youtube.accessToken
		}
	}).then(function(result){
		
		if(result && result.emails){
			user.email = result.emails[0].value;
			
			user.save();
		}
	}).catch(function(e){
		console.error('request', e.error);
	});
};