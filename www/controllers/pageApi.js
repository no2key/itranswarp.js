// page api

var
    _ = require('lodash'),
    async = require('async'),
    api = require('../api'),
    db = require('../db'),
    utils = require('./_utils'),
    constants = require('../constants');

var
    User = db.user,
    Page = db.page,
    Text = db.text,
    warp = db.warp,
    next_id = db.next_id;

function checkAliasAvailable(alias, tx, callback) {
    Page.find({
        where: 'alias=?',
        params: [alias]
    }, tx, function (err, entity) {
        if (err) {
            return callback(err);
        }
        if (entity !== null) {
            return callback(api.invalidParam('alias', 'duplicate alias'));
        }
        callback(null, true);
    });
}

function getPages(callback) {
    Page.findAll({ order: 'alias' }, callback);
}

function doFindPage(cond, tx, callback) {
    Page.find(cond, tx, function (err, page) {
        if (err) {
            return callback(err);
        }
        if (page === null) {
            return callback(api.notFound('Page'));
        }
        Text.find(page.content_id, tx, function (err, text) {
            if (err) {
                return callback(err);
            }
            if (text === null) {
                return callback(api.notFound('Text'));
            }
            page.content = text.value;
            return callback(null, page);
        });
    });
}

function getPage(id, tx, callback) {
    if (arguments.length === 2) {
        callback = tx;
        tx = undefined;
    }
    doFindPage(id, tx, callback);
}

function getPageByAlias(alias, tx, callback) {
    if (arguments.length === 2) {
        callback = tx;
        tx = undefined;
    }
    doFindPage({
        where: 'alias=?',
        params: [alias]
    }, tx, callback);
}

function getNavigationMenus(callback) {
    getPages(function (err, ps) {
        if (err) {
            return callback(err);
        }
        callback(null, _.map(ps, function (p) {
            return {
                name: p.name,
                url: '/page/' + p.alias
            };
        }));
    });
}

module.exports = {

    getNavigationMenus: getNavigationMenus,

    getPages: getPages,

    getPage: getPage,

    getPageByAlias: getPageByAlias,

    'GET /api/pages/:id': function (req, res, next) {
        /**
         * Get page by id.
         * 
         * @name Get Page
         * @param {string} id - The id of the page.
         * @return {object} Page object.
         */
        getPage(req.params.id, function (err, page) {
            if (err) {
                return next(err);
            }
            return res.send(page);
        });
    },

    'GET /api/pages': function (req, res, next) {
        /**
         * Get all pages object (but no content value).
         * 
         * @name Get Pages
         * @return {object} Result as {"pages": [{page}, {page}...]}
         */
        getPages(function (err, pages) {
            if (err) {
                return next(err);
            }
            res.send({ pages: pages });
        });
    },

    'POST /api/pages': function (req, res, next) {
        /**
         * Create a new page.
         * 
         * @name Create Page
         * @param {string} name: The name of the page.
         * @param {string} alias: The alias of the page.
         * @param {string} content: The content of the page.
         * @param {boolean} [draft=false]: The draft status of the page, default to false.
         * @param {string} [tags]: The tags of the page, seperated by ','.
         * @return {object} The created page object.
         */
        if (utils.isForbidden(req, constants.ROLE_ADMIN)) {
            return next(api.notAllowed('Permission denied.'));
        }
        var name, alias, content, draft, tags, content_id, page_id;
        try {
            name = utils.getRequiredParam('name', req);
            alias = utils.getRequiredParam('alias', req).toLowerCase();
            content = utils.getRequiredParam('content', req);
        } catch (e) {
            return next(e);
        }
        if (!/^[a-z0-9\-\_]{1,100}$/.test(alias)) {
            return next(api.invalidParam('alias'));
        }

        draft = 'true' === utils.getParam('draft', '', req);
        tags = utils.formatTags(utils.getParam('tags', '', req));

        content_id = next_id();
        page_id = next_id();

        warp.transaction(function (err, tx) {
            if (err) {
                return next(err);
            }
            async.waterfall([
                function (callback) {
                    // check alias exist:
                    checkAliasAvailable(alias, tx, callback);
                },
                function (aliasIsAvailable, callback) {
                    // create text:
                    Text.create({
                        id: content_id,
                        ref_id: page_id,
                        value: content
                    }, tx, callback);
                },
                function (text, callback) {
                    // create page:
                    Page.create({
                        id: page_id,
                        content_id: content_id,
                        alias: alias,
                        name: name,
                        tags: tags,
                        draft: draft
                    }, tx, callback);
                }
            ], function (err, result) {
                tx.done(err, function (err) {
                    if (err) {
                        return next(err);
                    }
                    result.content = content;
                    res.send(result);
                });
            });
        });
    },

    'POST /api/pages/:id': function (req, res, next) {
        /**
         * Update page by id.
         * 
         * @name Update Page
         * @param {string} id: The id of the page.
         * @param {string} [name]: The name of the page.
         * @param {string} [alias]: The alias of the page.
         * @param {string} [content]: The content of the page.
         * @param {boolean} [draft]: The draft status of the page.
         * @param {string} [tags]: The tags of the page, seperated by ','.
         * @return {object} Updated page object.
         */
        if (utils.isForbidden(req, constants.ROLE_ADMIN)) {
            return next(api.notAllowed('Permission denied.'));
        }
        var name = utils.getParam('name', req),
            alias = utils.getParam('alias', req),
            tags = utils.getParam('tags', req),
            draft = utils.getParam('draft', req),
            content = utils.getParam('content', req);
        if (name !== null && name === '') {
            return next(api.invalidParam('name'));
        }
        if (alias !== null) {
            alias = alias.toLowerCase();
            if (alias === '' || !/^[a-z0-9\-\_]{1,100}$/.test(alias)) {
                return next(api.invalidParam('alias'));
            }
        }
        if (tags !== null) {
            tags = utils.formatTags(tags);
        }
        if (content !== null && content === '') {
            return next(api.invalidParam('content'));
        }
        warp.transaction(function (err, tx) {
            if (err) {
                return next(err);
            }
            async.waterfall([
                function (callback) {
                    // get page by id:
                    Page.find(req.params.id, tx, callback);
                },
                function (page, callback) {
                    if (page === null) {
                        return callback(api.notFound('Page'));
                    }
                    // check alias:
                    if (alias !== null && page.alias !== alias) {
                        // check alias exist:
                        return checkAliasAvailable(alias, tx, function (err, result) {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, page);
                        });
                    }
                    // no need to update alias!
                    callback(null, page);
                },
                function (page, callback) {
                    // create Text if needed:
                    if (content !== null) {
                        console.log('Need update text...');
                        Text.create({
                            id: next_id(),
                            ref_id: page.id,
                            value: content
                        }, tx, function (err, text) {
                            page.content_id = text.id;
                            callback(err, page);
                        });
                        return;
                    }
                    callback(null, page);
                },
                function (page, callback) {
                    // update page:
                    if (name !== null) {
                        page.name = name;
                    }
                    if (alias !== null) {
                        page.alias = alias;
                    }
                    if (tags !== null) {
                        page.tags = tags;
                    }
                    if (draft !== null) {
                        page.draft = draft === 'true';
                    }
                    page.update(tx, callback);
                }
            ], function (err, result) {
                tx.done(err, function (err) {
                    if (err) {
                        return next(err);
                    }
                    if (content !== null) {
                        result.content = content;
                        return res.send(result);
                    }
                    Text.find(result.content_id, function (err, text) {
                        if (err) {
                            return next(err);
                        }
                        if (text === null) {
                            return next(api.notFound('Text'));
                        }
                        result.content = text.value;
                        res.send(result);
                    });
                });
            });
        });
    },

    'POST /api/pages/:id/delete': function (req, res, next) {
        /**
         * Delete a page by its id.
         * 
         * @name Delete Page
         * @param {string} id - The id of the page.
         * @return {object} Results contains id of the page, e.g. {"id": "12345"}
         */
        if (utils.isForbidden(req, constants.ROLE_ADMIN)) {
            return next(api.notAllowed('Permission denied.'));
        }
        warp.transaction(function (err, tx) {
            if (err) {
                return next(err);
            }
            async.waterfall([
                function (callback) {
                    Page.find(req.params.id, tx, callback);
                },
                function (page, callback) {
                    if (page === null) {
                        return callback(api.notFound('Page'));
                    }
                    page.destroy(tx, callback);
                },
                function (r, callback) {
                    // delete all texts:
                    warp.update('delete from texts where ref_id=?', [req.params.id], tx, callback);
                }
            ], function (err, result) {
                tx.done(err, function (err) {
                    if (err) {
                        return next(err);
                    }
                    res.send({ id: req.params.id });
                });
            });
        });
    }
};
