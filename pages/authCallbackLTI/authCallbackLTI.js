var ERR = require('async-stacktrace');
var express = require('express');
var router = express.Router();
var _ = require('lodash');
var oauthSignature = require('oauth-signature');

var sqldb = require('@prairielearn/prairielib').sqlDb;
var sqlLoader = require('@prairielearn/prairielib').sqlLoader;
var csrf = require('../../lib/csrf');
var config = require('../../lib/config');
var error = require('@prairielearn/prairielib').error;

var sql = sqlLoader.loadSqlEquiv(__filename);

router.post('/', function(req, res, next) {

    //console.log(res);

    //console.log(req.hostname);
    console.log(req.body);

    // TODO auto-generate this URL, or get from a config variable
    var url = 'http://endeavour.engr.illinois.edu:8009/pl/lti';

    var parameters = _.clone(req.body);
    var signature = req.body.oauth_signature;
    delete parameters.oauth_signature;

    // clone solves this for us
    // https://github.com/expressjs/express/issues/3264#issuecomment-290482333
    //Object.setPrototypeOf(parameters, {});


    if (parameters.lti_message_type != 'basic-lti-launch-request') {
        return next(error.make(500, 'Unsupported lti_message_type'));
    }

    if (parameters.lti_version != 'LTI-1p0') {
        return next(error.make(500, 'Unsupported lti_version'));
    }

    if (!parameters.oauth_consumer_key) {
        return next(error.make(500, 'Badly formed oauth_consumer_key'));
    }

    if (!parameters.resource_link_id) {
        return next(error.make(500, 'Badly formed resource_link_id'));
    }

    sqldb.queryZeroOrOneRow(sql.lookup_credential, {consumer_key: parameters.oauth_consumer_key}, function(err, result) {
        if (ERR(err, next)) return;
        if (result.rowCount == 0) return next(error.make(500, 'Unknown consumer_key'));

        var ltiresult = result.rows[0];

        var genSignature = oauthSignature.generate('POST', url, parameters, ltiresult.secret, null, {encodeSignature: false});

        if (genSignature != signature) {
            return next(error.make(500, 'Invalid signature'));
        }

        // Check oauth_timestamp within N seconds of now (3000 suggested)

        // Check nonce hasn't been used by that consumer_key in that timeframe

//        res.redirect(parameters.launch_presentation_return_url + "?lti_errorlog=Foobar");
//        return;

        var authUin = parameters.user_id + '@' + parameters.context_id;
        var authName = parameters.lis_person_name_full;
        var authUid = parameters.lis_person_contact_email_primary || authUin;

        var params = [
        authUid,
        authName,
        authUin,
        'LTI-ci' + ltiresult.course_instance_id,
        ];

        sqldb.call('users_select_or_insert', params, (err, result) => {
            if (ERR(err, next)) return;
            var tokenData = {
                user_id: result.rows[0].user_id,
                // Something for outcomes here,
                lti_launch_presentation_return_url: parameters.launch_presentation_return_url,
            };
            var pl_authn = csrf.generateToken(tokenData, config.secretKey);
            res.cookie('pl_authn', pl_authn, {maxAge: 24 * 60 * 60 * 1000});

            var params = {
                course_instance_id: ltiresult.course_instance_id,
                user_id: tokenData.user_id,
                req_date: res.locals.req_date,
            };

            // TODO: Change this to an UPSERT
            sqldb.queryOneRow(sql.enroll, params, function(err, _result) {
                if (ERR(err, next)) return;

                var redirUrl = res.locals.homeUrl;
                /*
                if ('preAuthUrl' in req.cookies) {
                    redirUrl = req.cookies.preAuthUrl;
                    res.clearCookie('preAuthUrl');
                }
                */
                res.redirect(redirUrl);
            });
        });
    });
});

module.exports = router;
