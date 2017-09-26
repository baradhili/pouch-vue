(function () {
    var vue = null;
    var pouch = null;
    var defaultDB = null;
    var defaultUsername = null;
    var defaultPassword = null;
    var databases = {};

    var vuePouch = {
        destroyed: function () {
            Object.values(this._liveFinds).map(function (lf) {
                lf.cancel();
            });
        },
        created: function () {
            if (!vue) {
                console.warn('[vue-pouch] not installed!');
                return;
            }
            var defineReactive = vue.util.defineReactive;
            var vm = this;
            vm._liveFinds = {};

            if (defaultDB) {
                databases[defaultDB] = new pouch(defaultDB);
            }

            function fetchSession() {
                return new Promise(function (resolve) {
                    databases[defaultDB].getSession().then(function (session) {
                        console.log(session);
                        databases[defaultDB].getUser(session.userCtx.name)
                            .then(function (userData) {
                                var userObj = Object.assign({}, session.userCtx, { displayName: userData.displayname });
                                resolve({
                                    user: userObj,
                                    hasAccess: true,
                                });
                            }).catch(function (error) {
                                resolve(error);
                            });
                    }).catch(function (error) {
                        resolve(error);
                    });
                });
            }

            function login() {
                return new Promise(function (resolve) {
                    databases[defaultDB].login(defaultUsername, defaultPassword)
                        .then(function (user) {
                            databases[defaultDB].getUser(user.name)
                                .then(function (userData) {
                                    var userObj = Object.assign({}, user, { displayName: userData.displayname });
                                    resolve({
                                        user: userObj,
                                        hasAccess: true,
                                    });
                                }).catch(function (error) {
                                    resolve(error);
                                });
                        })
                        .catch(function (error) {
                            resolve(error);
                        });
                });
            }

            var $pouch = {
                version: '0.0.3',
                connect: function (username, password) {
                    return new Promise(function (resolve) {
                        defaultUsername = username;
                        defaultPassword = password;

                        if (!databases[defaultDB]._remote) {
                            resolve({
                                message: 'database is not remote',
                                error: 'bad request',
                                status: 400,
                            });
                            return;
                        }

                        login().then(function (res) {
                            resolve(res);
                        });
                    });
                },
                createUser: function (username, password) {
                    return databases[defaultDB].signup(username, password).then(function () {
                        return vm.$pouch.connect(username, password);
                    }).catch(function (error) {
                        return new Promise(function (resolve) {
                            resolve(error);
                        });
                    });
                },
                disconnect: function () {
                    return new Promise(function (resolve) {
                        defaultUsername = null;
                        defaultPassword = null;

                        if (!databases[defaultDB]._remote) {
                            resolve({
                                message: 'database is not remote',
                                error: 'bad request',
                                status: 400,
                            });
                            return;
                        }

                        databases[defaultDB].logout()
                            .then(function (res) {
                                resolve({
                                    ok: res.ok,
                                    user: null,
                                    hasAccess: false,
                                });
                            }).catch(function (error) {
                                resolve(error);
                            });
                    });
                },

                getSession: function () {
                    if (!databases[defaultDB]._remote) {
                        return new Promise(function (resolve) {
                            resolve(true);
                        });
                    }
                    return fetchSession();
                },

                sync: function (localDB, remoteDB, _options) {
                    if (!databases[localDB]) databases[localDB] = new pouch(localDB);
                    if (!databases[remoteDB]) databases[remoteDB] = new pouch(remoteDB);
                    if (!defaultDB) defaultDB = databases[remoteDB];
                    var options = Object.assign({}, _options, { live: true, retry: true }),
                        numPaused = 0;
                    vm.$pouch.loading[localDB] = true;
                    pouch.sync(databases[localDB], databases[remoteDB], options)
                        .on('paused', function (err) {
                            if (err) {
                                vm.$pouch.errors[localDB] = err;
                                vm.$pouch.errors = Object.assign({}, vm.$pouch.errors);
                                vm.$emit('pouchdb-sync-error', err);
                                return;
                            }
                            numPaused += 1;
                            if (numPaused >= 2) {
                                vm.$pouch.loading[localDB] = false;
                                vm.$pouch.loading = Object.assign({}, vm.$pouch.loading);
                                vm.$emit('pouchdb-sync-paused', true);
                            }
                        })
                        .on('change', function (info) {
                            vm.$emit('pouchdb-sync-change', info);
                        })
                        .on('active', function () {
                            vm.$emit('pouchdb-sync-active', true);
                        })
                        .on('denied', function (err) {
                            vm.$pouch.errors[localDB] = err;
                            vm.$pouch.errors = Object.assign({}, vm.$pouch.errors);
                            vm.$emit('pouchdb-sync-denied', err);
                        })
                        .on('complete', function (info) {
                            vm.$emit('pouchdb-sync-complete', info);
                        })
                        .on('error', function (err) {
                            vm.$pouch.errors[localDB] = err;
                            vm.$pouch.errors = Object.assign({}, vm.$pouch.errors);
                            vm.$emit('pouchdb-sync-error', error);
                        });

                    fetchSession(databases[remoteDB]);
                },
                push: function (localDB, remoteDB, options) {
                    if (!databases[localDB]) databases[localDB] = new pouch(localDB);
                    if (!databases[remoteDB]) databases[remoteDB] = new pouch(remoteDB);
                    if (!defaultDB) defaultDB = databases[remoteDB];
                    databases[localDB].replicate.to(databases[remoteDB], options)
                        .on('paused', function (err) {
                            vm.$emit('pouchdb-push-error', err);
                        })
                        .on('change', function (info) {
                            vm.$emit('pouchdb-push-change', info);
                        })
                        .on('active', function () {
                            vm.$emit('pouchdb-push-active', true);
                        })
                        .on('denied', function (err) {
                            vm.$pouch.errors[localDB] = err;
                            vm.$pouch.errors = Object.assign({}, vm.$pouch.errors);
                            vm.$emit('pouchdb-push-denied', err);
                        })
                        .on('complete', function (info) {
                            vm.$emit('pouchdb-push-complete', info);
                        })
                        .on('error', function (err) {
                            vm.$pouch.errors[localDB] = err;
                            vm.$pouch.errors = Object.assign({}, vm.$pouch.errors);
                            vm.$emit('pouchdb-push-error', err);
                        });

                    fetchSession(databases[remoteDB]);
                },
                put: function (db, object, options) {
                    return databases[db].put(object, options);
                },
                post: function (db, object, options) {
                    return databases[db].post(object, options);
                },
                remove: function (db, object, options) {
                    return databases[db].remove(object, options);
                },
                query: function (db, options) {
                    return databases[db].query(options ? options : {});
                },
                allDocs: function (db, options) {
                    return databases[db].allDocs(options ? options : {});
                },

                get: function (db, object, options) {
                    return databases[db].get(object, options ? options : {});
                },
                errors: {},
                loading: {},
            };

            defineReactive(vm, '$pouch', $pouch);
            vm.$databases = databases; // Add non-reactive property

            var pouchOptions = this.$options.pouch;

            if (!pouchOptions) {
                return;
            }

            if (typeof pouchOptions === 'function') {
                pouchOptions = pouchOptions();
            }
            Object.keys(pouchOptions).map(function (key) {
                var pouchFn = pouchOptions[key];
                if (typeof pouchFn !== 'function') {
                    pouchFn = function () {
                        return pouchOptions[key];
                    };
                }
                if (typeof vm.$data[key] === 'undefined') vm.$data[key] = null;
                defineReactive(vm, key, null);
                vm.$watch(pouchFn, function (config) {
                    if (!config) {
                        if (!vm[key]) vm[key] = [];
                        return;
                    }
                    var selector, sort, skip, limit, first;
                    if (config.selector) {
                        selector = config.selector;
                        sort = config.sort;
                        skip = config.skip;
                        limit = config.limit;
                        first = config.first;
                    } else {
                        selector = config;
                    }

                    var databaseParam = config.database || key;
                    var db = null;
                    if (typeof databaseParam === 'object') {
                        db = databaseParam;
                    } else if (typeof databaseParam === 'string') {
                        if (!databases[databaseParam]) {
                            databases[databaseParam] = new pouch(databaseParam);
                            login(databases[databaseParam]);
                        }
                        db = databases[databaseParam];
                    }
                    if (!db) {
                        return;
                    }
                    if (vm._liveFinds[key]) {
                        vm._liveFinds[key].cancel();
                    }
                    var aggregateCache = [];
                    vm._liveFinds[key] = db.liveFind({
                        selector: selector,
                        sort: sort,
                        skip: skip,
                        limit: limit,
                        aggregate: true,
                    }).on('update', function (update, aggregate) {
                        if (first && aggregate) aggregate = aggregate[0];
                        vm[key] = aggregateCache = aggregate;
                    }).on('ready', function () {
                        vm[key] = aggregateCache;
                    });
                }, {
                        immediate: true,
                    });
            });
        },
    };

    function installSelectorReplicationPlugin() {
        // This plugin enables selector-based replication
        pouch.plugin(function (pouch) {
            var oldReplicate = pouch.replicate;
            pouch.replicate = function (source, target, repOptions) {
                var sourceAjax = source._ajax;
                source._ajax = function (ajaxOps, callback) {
                    if (ajaxOps.url.includes('_selector')) {
                        ajaxOps.url = ajaxOps.url.replace('filter=_selector%2F_selector', 'filter=_selector');
                        ajaxOps.method = 'POST';
                        ajaxOps.body = {
                            selector: repOptions.selector,
                        };
                    }
                    return sourceAjax(ajaxOps, callback);
                };
                return oldReplicate(source, target, repOptions);
            };
        });
    }

    var api = {
        mixin: vuePouch,
        install: function (Vue, options) {
            vue = Vue;
            pouch = (options && options.pouch) || PouchDB;
            installSelectorReplicationPlugin();
            defaultDB = (options && options.defaultDB);
            opts = Vue.options;
            Vue.options = Vue.util.mergeOptions(Vue.options, vuePouch);
        },
    };

    if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = api;
    } else if (typeof define === 'function' && define.amd) {
        define(function () {
            return api;
        });
    } else if (typeof window !== 'undefined') {
        window.VuePouch = api;
    }
})();
