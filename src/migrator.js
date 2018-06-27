var request = require('request'),
    Q = require('q');

//request.debug = true;

function Migrator(endpoints, conf) {
    this.endpoints = endpoints;
    this.conf = conf;
    this.user = this.conf.bitbucket.team == null ? this.conf.bitbucket.user : this.conf.bitbucket.team;
    this.repos = [];
}

Migrator.prototype.startMigration = function() {
    this.getAllRepos()
    .then(function(repos) {
        return this.migrateRepos(repos);
    }.bind(this))
    .then(function(){
        console.log("Finished, "+this.repos.length+" repos migrated");
    });
}

Migrator.prototype.getAllRepos = function() {
    var bb = this.conf.bitbucket,
        gogs = this.conf.gogs,
        realUser = bb.team === null ? bb.user : bb.team,
        deferred = Q.defer();

    console.log('Finding all repos for user: ' + realUser);

    this.getRepoSet(this.endpoints.bitbucket.all, deferred);
    return deferred.promise;
}

Migrator.prototype.getRepoSet = function(uri, deferred, start=0) {
    var bb = this.conf.bitbucket,
        gogs = this.conf.gogs,
        realUser = bb.team === null ? bb.user : bb.team;

    console.log("Getting repos from: "+uri);

    request({
        method: 'GET',
        uri: uri + "?start=" + start,
        auth: {
            'user': bb.user,
            'pass': bb.password,
        }
    }, function(err, res, body) {
        try {
            var rawData = JSON.parse(body);
        } catch (e) {
            console.error('\nInvalid JSON data received from BitBucket');
            console.error('Data received: ')
            console.error('\t'+body + '\n');
            console.error('Error: ' +e);
            process.exit(1);
        }

        rawData.values.forEach(function(data) {
            var href;
            data.links.clone.forEach(function(c) {
                if(c.name === "http") href = c.href.replace(bb.user + '@', '');
            }.bind(this))
            console.log(href);
            this.repos.push({name: data.name, slug: data.slug, href: href});
        }.bind(this));

        if (rawData.nextPageStart) {
            console.log("get next page");
            this.getRepoSet(uri, deferred, rawData.nextPageStart);
        } else {
            deferred.resolve(this.repos);
        }
    }.bind(this));
}

Migrator.prototype.migrateRepos = function(repos) {
    var deferred = Q.defer(),
        uri = this.endpoints.gogs.migrate;

    this.migrate(repos, deferred);

    return deferred.promise;
}

Migrator.prototype.migrate = function(repos, deferred) {
    if (repos.length !== 0) {
        // We want to work with the last repo name
        var repo = repos[repos.length - 1],
            repoName = repo.slug,
            href = repo.href;

        // Starts the migration through Gogs API
        var formData = {
            clone_addr: href,
            auth_username: this.conf.bitbucket.user,
            auth_password: this.conf.bitbucket.password,
            uid: this.conf.gogs.owner_id,
            repo_name: repoName,
            mirror: 'false',
            private: 'true'
        };

        request({
            method: 'POST',
            uri: this.endpoints.gogs.migrate,
            formData: formData,
            headers: {
                'Authorization': 'token ' + this.conf.gogs.token
            }
        }, function(err, res, body) {
            if (err) {
                console.error(err);
                process.exit(1);
            }
            console.log(body);
            console.log("Repository `"+fullName+"` has been migrated");

            // Removes the element from the array, and calls ourself again
            repos.pop();
            this.migrate(repos, deferred);
        }.bind(this));
    } else {
        console.log('Done');
        deferred.resolve('Done');
    };
}

module.exports = Migrator;
