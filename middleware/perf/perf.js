var path = require('path');
var fs = require('fs');
var http = require('http');
var mime = require("mime");
var util = require("../../util/util");

/**
 * Performance middleware.
 *
 * Applies cache headers to commonly requested mimetypes to ensure that appropriate client side caching is in place.
 * Also strips out filename cache keys (filename-<MD5>.extension) so that incoming requests resolve properly.
 *
 * @type {Function}
 */
exports = module.exports = function()
{
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // RESULTING OBJECT
    //
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////

    var MAXAGE_ONE_YEAR_SECONDS = 31536000;
    var MAXAGE_ONE_HOUR_SECONDS = 3600;
    var MAXAGE_ONE_WEEK_SECONDS = 604800;

    var TEST_MODE = false;

    var r = {};

    /**
     * Supports pre-proxy caching of resources based on file path.
     *
     * Supports config like:
     *
     * {
     *    "perf": {
     *       "enabled": true,
     *       "paths": [{
     *          "regex": "/proxy/repositories/.*",
     *          "cache": {
     *              "seconds": 60 (or 0 for no cache and -1 for 1 year)
     *          }
     *       }]
     *    }
     * }
     *
     * @return {Function}
     */
    r.pathPerformanceInterceptor = function()
    {
        return util.createInterceptor("perf", function(req, res, next, configuration, stores) {

            // NOTE: if we're not in production mode, we don't do any of this
            if (process.env.CLOUDCMS_APPSERVER_MODE == "production" || TEST_MODE)
            {
                var paths = configuration.paths;
                if (paths)
                {
                    for (var i = 0; i < paths.length; i++)
                    {
                        if (paths[i].regex && paths[i].cache)
                        {
                            var regex = new RegExp(paths[i].regex);
                            if (regex.test(req.path))
                            {
                                var cacheSettings = paths[i].cache;
                                if (cacheSettings)
                                {
                                    var cacheControl = null;
                                    var pragma = null;
                                    var expires = null;

                                    if (typeof(cacheSettings) !== "undefined")
                                    {
                                        if (cacheSettings.seconds === -1)
                                        {
                                            cacheSettings.seconds = MAXAGE_ONE_YEAR_SECONDS;
                                        }

                                        if (cacheSettings.seconds === 0)
                                        {
                                            cacheControl = "max-age=0, no-cache, no-store";
                                            pragma = "no-cache";
                                            expires = "Mon, 7 Apr 2012, 16:00:00 GMT"; // some time in the past
                                        }
                                        else if (cacheSettings.seconds > 0)
                                        {
                                            cacheControl = "public, max-age=" + cacheSettings.seconds;
                                            pragma = "public";
                                            expires = new Date(Date.now() + (cacheSettings.seconds * 1000)).toUTCString();
                                        }
                                    }

                                    if (cacheControl)
                                    {
                                        res.setHeader("Cache-Control", cacheControl);
                                    }

                                    if (pragma)
                                    {
                                        res.setHeader("Pragma", pragma);
                                    }

                                    if (expires)
                                    {
                                        res.setHeader("Expires", expires);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            next();
        });
    };

    /**
     * Supports post-proxy caching of resources based on mimetype.
     *
     *   /hosts
     *     /<host>
     *       /public
     *
     * @return {Function}
     */
    r.mimeTypePerformanceInterceptor = function()
    {
        return util.createInterceptor("perf", function(req, res, next, configuration, stores) {

            // NOTE: if we're not in production mode, we don't do any of this
            if (process.env.CLOUDCMS_APPSERVER_MODE == "production" || TEST_MODE)
            {
                var assetPath = req.path;
                if (assetPath)
                {
                    var queryString = null;
                    if (req.url.indexOf("?") > -1) {
                        queryString = req.url.substring(req.url.indexOf("?")  + 1);
                    }

                    var dir = path.dirname(assetPath);

                    var filename = path.basename(assetPath);
                    if (filename)
                    {
                        // does the filename look like: <originalFilename>-<key>.<ext>?
                        var originalFilename = null;
                        var key = null;
                        var extension = null;

                        // pull apart if possible
                        var car = filename;
                        var x = car.indexOf(".");
                        if (x > -1)
                        {
                            extension = car.substring(x+1);
                            car = car.substring(0,x);
                        }
                        else
                        {
                            extension = null;
                            car = filename;
                        }
                        var regex1 = new RegExp("-[0-9a-f]{32}$");
                        var regex2 = new RegExp("-[0-9]{13}$");
                        if (regex1.test(car) || regex2.test(car))
                        {
                            var x = car.lastIndexOf("-");

                            originalFilename = car.substring(0,x);
                            key = car.substring(x+1);
                        }
                        else
                        {
                            originalFilename = car;
                            key = null;
                        }

                        // if we have a cache key, then we set headers to ALWAYS cache
                        var cacheControl = null;
                        if (key)
                        {
                            //res.setHeader('Cache-Control', 'public, max-age=' + (this._maxage / 1000));
                            //res.setHeader("Cache-Control", "no-cache");
                            //res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
                            cacheControl = "public, max-age=2592000"; // 30 days
                        }
                        else if (extension)
                        {
                            // set cache based on file extension
                            var ext = path.extname(filename);
                            if (ext)
                            {
                                var mimetype = mime.lookup(ext);
                                if (mimetype)
                                {
                                    var isCSS = ("text/css" == mimetype);
                                    var isImage = (mimetype.indexOf("image/") > -1);
                                    var isJS = ("text/javascript" == mimetype) || ("application/javascript" == mimetype);
                                    var isHTML = ("text/html" == mimetype);

                                    // html
                                    if (isHTML)
                                    {
                                        cacheControl = "public, max-age=" + MAXAGE_ONE_HOUR_SECONDS;
                                    }

                                    // css, images and js get 1 year
                                    if (isCSS || isImage || isJS)
                                    {
                                        cacheControl = "public, max-age=" + MAXAGE_ONE_YEAR_SECONDS;
                                    }
                                }
                            }
                        }

                        if (!cacheControl)
                        {
                            // set to no-cache
                            cacheControl = "no-cache";
                        }

                        //res.setHeader("Cache-Control", cacheControl);
                        try { res.header('Cache-Control', cacheControl); } catch (e) { }

                        // set new url
                        var newUrl = path.join(dir, originalFilename);
                        if (extension) {
                            newUrl += "." + extension
                        }
                        if (queryString) {
                            newUrl += "?" + queryString;
                        }
                        req.url = newUrl;
                    }
                }
            }

            next();
        });
    };

    return r;
}();





