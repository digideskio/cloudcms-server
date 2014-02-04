var path = require('path');
var fs = require('fs');

var mkdirp = require('mkdirp');

/**
 * Supports the following directory structure:
 *
 *
 *   /hosts
 *
 *      /abc.cloudcms.net
 *
 *         /public
              index.html
 *
 *         /content
 *            /local
 *               /en_us
 *                  image.jpg
 *
 *            /cloudcms
 *               /<branchId>
 *                  /en_us
 *                     image.jpg
 *
 * @type {exports}
 */
exports = module.exports = function()
{
    // TODO: this is to disable really annoying Express 3.0 deprecated's for multipart() which should hopefully
    // TODO: be resolved soon
    console.warn = function() {};

    // this is the root path where hosts, their public files and content caches are stored
    var basePath = process.env.CLOUDCMS_HOSTS_PATH;
    if (!basePath) {
        basePath = "/hosts";
    }

    // subsystems
    var deployment = require("./lib/deployment/deployment")(basePath);
    var virtualHost = require("./lib/virtualhost/virtualhost")(basePath);
    var authorization = require("./lib/authorization/authorization")(basePath);
    var cloudcms = require("./lib/cloudcms/cloudcms")(basePath);
    var wcm = require("./lib/cloudcms/wcm")(basePath);
    var cms = require("./lib/cms/cms")(basePath);
    var local = require("./lib/local/local")(basePath);
    var final = require("./lib/final/final")(basePath);
    var libraries = require("./lib/libraries/libraries")(basePath);
    var cache = require("./lib/cache/cache")(basePath);
    var welcome = require("./lib/welcome/welcome")(basePath);

    // config service
    var config = require("./lib/config")(basePath);

    // init
    if (!process.env.GITANA_PROXY_HOST) {
        process.env.GITANA_PROXY_HOST = "api.cloudcms.com";
    }
    if (!process.env.GITANA_PROXY_PORT) {
        process.env.GITANA_PROXY_PORT = 443;
    }
    if (!process.env.GITANA_PROXY_SCHEME) {
        process.env.GITANA_PROXY_SCHEME = "https";
    }
    if (!process.env.CLOUDCMS_HOSTS_PATH) {
        process.env.CLOUDCMS_HOSTS_PATH = "/hosts";
    }

    // assume app-server base path if none provided
    if (!process.env.CLOUDCMS_APPSERVER_BASE_PATH) {
        process.env.CLOUDCMS_APPSERVER_BASE_PATH = process.cwd();
    }

    if (!process.env.CLOUDCMS_APPSERVER_PUBLIC_PATH) {
        process.env.CLOUDCMS_APPSERVER_PUBLIC_PATH = path.join(process.env.CLOUDCMS_APPSERVER_BASE_PATH, "public");
    }

    // other paths we can pre-establish
    process.env.CLOUDCMS_GITANA_JSON_PATH = path.join(process.env.CLOUDCMS_APPSERVER_BASE_PATH, "gitana.json");
    process.env.CLOUDCMS_CONFIG_BASE_PATH = path.join(process.env.CLOUDCMS_APPSERVER_BASE_PATH, "config");

    // cache
    process.cache = cache;

    // read the package.json file and determine the build timestamp
    var packageJsonPath = path.resolve("package.json");
    if (fs.existsSync(packageJsonPath))
    {
        var packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());

        process.env.CLOUDCMS_APPSERVER_PACKAGE_NAME = packageJson.name;
        process.env.CLOUDCMS_APPSERVER_PACKAGE_VERSION = packageJson.version;
    }

    // make sure that the /hosts directory exists if it does not
    if (!fs.existsSync(process.env.CLOUDCMS_HOSTS_PATH))
    {
        console.log("Creating hosts path: " + process.env.CLOUDCMS_HOSTS_PATH);

        mkdirp(process.env.CLOUDCMS_HOSTS_PATH, function() {
            // all done
        });
    }
    console.log("Mounting hosts path: " + process.env.CLOUDCMS_HOSTS_PATH);

    // object that we hand back
    var r = {};

    r.virtual = function(app, configuration)
    {
        if (!configuration) {
            configuration = {};
        }

        // bind cache
        app.cache = cache;

        // welcome support
        app.use(welcome.welcomeInterceptor(configuration));

        // set up virtualization
        app.use(virtualHost.virtualHostInterceptor(configuration));
        app.use(virtualHost.virtualDriverConfigInterceptor(configuration));
        app.use(virtualHost.virtualFilesInterceptor(configuration));

        // ensure that a gitana driver instance is bound to the request
        app.use(cloudcms.driverInterceptor(configuration));
    };

    r.interceptors = function(app, includeCloudCMS, configuration)
    {
        if (!configuration) {
            configuration = {};
        }

        if (includeCloudCMS) {

            // bind a cache helper
            app.use(cache.cacheInterceptor());

            // auto-select which gitana repository to use
            app.use(cloudcms.repositoryInterceptor());

            // auto-select which gitana branch to use
            // allows for branch specification via request parameter
            app.use(cloudcms.branchInterceptor());

            // enables ICE menu
            app.use(cloudcms.iceInterceptor());
        }

        // cms (tag processing, injection of scripts, etc, kind of a catch all at the moment)
        app.use(cms.interceptor(configuration));
    };

    r.handlers = function(app, includeCloudCMS, configuration)
    {
        if (!configuration) {
            configuration = {};
        }

        // handles deploy/undeploy commands
        app.use(deployment.handler());

        // handles the retrieval of configuration
        app.use(config.handler());

        // libraries
        app.use(libraries.handler());
        app.use(function(req, res, next) {
            next();
        });

        if (includeCloudCMS) {

            // cloudcms domain principal authentication
            app.use(cloudcms.authenticationHandler(app));

            // handles virtualized content retrieval from Cloud CMS
            app.use(cloudcms.virtualHandler());
        }

        // handles virtualized local content retrieval from disk
        app.use(local.virtualHandler());

        // handles default content retrieval from disk
        app.use(local.defaultHandler());

        if (includeCloudCMS)
        {
            // handles WCM
            app.use(wcm.wcmHandler(configuration));
        }

        // handles 404
        app.use(final.finalHandler());

    };

    r.bodyParser = function()
    {
        return function(req, res, next)
        {
            if (req._body)
            {
                return next();
            }

            var contentType = req.get("Content-Type");
            //if (contentType == "application/json" && req.method.toLowerCase() == "post") {
            if (req.method.toLowerCase() == "post") {

                req._body = true;

                var responseString = "";

                req.on('data', function(data) {
                    responseString += data;
                });

                req.on('end', function() {

                    if (responseString.length > 0) {

                        try {
                            var b = JSON.parse(responseString);
                            if (b)
                            {
                                req.body = b;
                            }
                        } catch (e) { }
                    }

                    next();
                });
            }
            else
            {
                next();
            }
        };
    };

    /**
     * Ensures that headers are set to enable CORS cross-domain functionality.
     *
     * @returns {Function}
     */
    r.ensureCORSCrossDomain = function()
    {
        return function(req, res, next) {

            var origin = req.get("Origin");
            if (!origin)
            {
                origin = req.get("origin");
            }

            if (!origin) {
                return next();
            }

            // use "*" here to accept any origin
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization');
            // res.set('Access-Control-Allow-Max-Age', 3600);

            if ('OPTIONS' == req.method) {
                return res.send(200);
            }

            next();
        };
    };

    return r;
}();

