'use strict';

exports.handler = (event, context, callback) => {
    let credentials = event.headers.Authorization;
    try {
        if(credentials.indexOf('Basic ') === -1) throw 'unauthorized';
        credentials = Buffer(credentials.split(' ')[1], 'base64').toString();
        credentials = credentials.split(':');
        const regex_ = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[#$^+=!*()@%&]).{8,20}$/;
        if(!regex_.test(credentials[1])) throw 'unauthorized';
    } catch(err) {
        callback('Unauthorized', null);
    }
    var client_id = credentials[0];

    // authPolicy parameters
    const method_arn = event.methodArn.split(':');
    const api_gateway_arn = method_arn[5].split('/');
    const aws_account = method_arn[4];
    let api_options = {
        region: method_arn[3],
        restApiId: api_gateway_arn[0],
        stage: api_gateway_arn[1],
    };
    const method = api_gateway_arn[2];
    let resource = '/';
    if(api_gateway_arn[3]) {
        resource += api_gateway_arn.slice(3).join('/');
    }

    // create policy
    let policy = new AuthPolicy(client_id, aws_account, api_options);
    policy.allowMethod(AuthPolicy.HttpVerb.GET, 'upload-status');
    policy.allowMethod(AuthPolicy.HttpVerb.GET, 'user-consumption');
    let auth_response = policy.build();
 
    callback(null, auth_response);
};

function AuthPolicy(principal, awsAccountId, apiOptions) {
    this.awsAccountId = awsAccountId;
    this.principalId = principal;
    this.version = '2012-10-17';
    this.pathRegex = new RegExp('^[/.a-zA-Z0-9-\*]+$');

    this.allowMethods = [];
    this.denyMethods = [];

    ['restApiId', 'region', 'stage'].map(option => {
        this[option] = typeof apiOptions[option] === 'undefined' ? '*' : apiOptions[option];
    })
};

 AuthPolicy.HttpVerb = {
   GET     : "GET",
   POST    : "POST",
   PUT     : "PUT",
   PATCH   : "PATCH",
   HEAD    : "HEAD",
   DELETE  : "DELETE",
   OPTIONS : "OPTIONS",
   ALL     : "*"
 };

AuthPolicy.prototype = (function() {
  var addMethod = function(effect, verb, resource, conditions) {
    if (verb != "*" && !AuthPolicy.HttpVerb.hasOwnProperty(verb)) {
      throw new Error("Invalid HTTP verb " + verb + ". Allowed verbs in AuthPolicy.HttpVerb");
    }

    if (!this.pathRegex.test(resource)) {
      throw new Error("Invalid resource path: " + resource + ". Path should match " + this.pathRegex);
    }

    var cleanedResource = resource;
    if (resource.substring(0, 1) == "/") {
        cleanedResource = resource.substring(1, resource.length);
    }
    var resourceArn = "arn:aws:execute-api:" +
      this.region + ":" +
      this.awsAccountId + ":" +
      this.restApiId + "/" +
      this.stage + "/" +
      verb + "/" +
      cleanedResource;

    if (effect.toLowerCase() == "allow") {
      this.allowMethods.push({
        resourceArn: resourceArn,
        conditions: conditions
      });
    } else if (effect.toLowerCase() == "deny") {
      this.denyMethods.push({
        resourceArn: resourceArn,
        conditions: conditions
      })
    }
  };

  var getEmptyStatement = function(effect) {
    effect = effect.substring(0, 1).toUpperCase() + effect.substring(1, effect.length).toLowerCase();
    var statement = {};
    statement.Action = "execute-api:Invoke";
    statement.Effect = effect;
    statement.Resource = [];

    return statement;
  };

  var getStatementsForEffect = function(effect, methods) {
    var statements = [];

    if (methods.length > 0) {
      var statement = getEmptyStatement(effect);

      for (var i = 0; i < methods.length; i++) {
        var curMethod = methods[i];
        if (curMethod.conditions === null || curMethod.conditions.length === 0) {
          statement.Resource.push(curMethod.resourceArn);
        } else {
          var conditionalStatement = getEmptyStatement(effect);
          conditionalStatement.Resource.push(curMethod.resourceArn);
          conditionalStatement.Condition = curMethod.conditions;
          statements.push(conditionalStatement);
        }
      }

      if (statement.Resource !== null && statement.Resource.length > 0) {
        statements.push(statement);
      }
    }

    return statements;
  };

  return {
    constructor: AuthPolicy,

    allowAllMethods: function() {
      addMethod.call(this, "allow", "*", "*", null);
    },

    denyAllMethods: function() {
      addMethod.call(this, "deny", "*", "*", null);
    },

    allowMethod: function(verb, resource) {
      addMethod.call(this, "allow", verb, resource, null);
    },

    denyMethod : function(verb, resource) {
      addMethod.call(this, "deny", verb, resource, null);
    },

    allowMethodWithConditions: function(verb, resource, conditions) {
      addMethod.call(this, "allow", verb, resource, conditions);
    },

    denyMethodWithConditions : function(verb, resource, conditions) {
      addMethod.call(this, "deny", verb, resource, conditions);
    },

    build: function() {
      if ((!this.allowMethods || this.allowMethods.length === 0) &&
          (!this.denyMethods || this.denyMethods.length === 0)) {
        throw new Error("No statements defined for the policy");
      }

      var policy = {};
      policy.principalId = this.principalId;
      var doc = {};
      doc.Version = this.version;
      doc.Statement = [];

      doc.Statement = doc.Statement.concat(getStatementsForEffect.call(this, "Allow", this.allowMethods));
      doc.Statement = doc.Statement.concat(getStatementsForEffect.call(this, "Deny", this.denyMethods));

      policy.policyDocument = doc;

      return policy;
    }
  };

})();