var path = require('path');
var fs = require('fs');
var http = require('http');

var GithubStrategy = require('passport-github').Strategy;

/**
 * Handles github authentication.
 *
 * Configuration
 *
 *    "github": {
 *       "enabled": true,
 *       "successRedirect": "/",
 *       "failureRedirect": "/",
 *       "callbackUrl": "/auth/github/callback",
 *       "clientID": "[OAuth2 Client ID]",
 *       "clientSecret": "[OAuth2 Client Secret]",
 *    }
 * }
 *
 * @return {Function}
 */
exports = module.exports = function(passport, config)
{
    var PROVIDER_ID = "github";
    var PROVIDER_TITLE = "Github";

    var r = {};

    var adapter = require("../adapter")(PROVIDER_ID, r, config);

    passport.use(new GithubStrategy({
            clientID: config.clientID,
            clientSecret: config.clientSecret,
            callbackURL: config.callbackUrl,
            passReqToCallback: true
        },
        adapter.verifyCallback
    ));

    r.providerId = function()
    {
        return PROVIDER_ID;
    };

    r.providerTitle = function()
    {
        return PROVIDER_TITLE;
    };

    r.handleLogin = function(req, res, next)
    {
        passport.authenticate(PROVIDER_ID)(req, res, next);
        passport.authenticate(PROVIDER_ID,{
            scope: ['user']
        })(req, res, next);
    };

    r.handleCallback = function(req, res, next, cb)
    {
        passport.authenticate(PROVIDER_ID, {
            successRedirect: config.successRedirect,
            failureRedirect: config.failureRedirect//,
            //session: false
        }, cb)(req, res, next);
    };

    r.providerUserId = function(profile)
    {
        return profile.id;
    };

    r.handleSyncProfile = function(req, token, tokenSecret, profile, user, callback)
    {
        adapter.syncProfile(profile, user, function() {

            if (!user.firstName)
            {
                user.firstName = profile._json.name.givenName;
            }

            if (!user.lastName)
            {
                user.lastName = profile._json.name.familyName;
            }

            if (!user.gender)
            {
                user.gender = profile._json.gender;
            }

            callback();
        });
    };

    r.handleSyncAvatar = function(req, profile, user, callback)
    {
        callback();
    };

    return r;
};
