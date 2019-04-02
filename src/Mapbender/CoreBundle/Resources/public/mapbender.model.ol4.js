/**
 *
 * @param {Object} mbMap
 * @constructor
 */
Mapbender.Model = function(mbMap) {
    'use strict';
    this.mbMap = mbMap;
    Mapbender.mapEngine.patchGlobals(mbMap.options);
    this.srsDefs = this.mbMap.options.srsDefs;
    Mapbender.Projection.extendSrsDefintions(this.srsDefs || []);

    this.sourceTree = [];
    this._initMap();
};


Mapbender.Model.prototype = {
    constructor: Mapbender.Model,
    sourceTree: [],
    _initMap: function() {
        var options = {
            srs: this.mbMap.options.srs,
            maxExtent: this.sanitizeExtent(this.mbMap.options.extents.max),
            startExtent: this.sanitizeExtent(this.mbMap.options.extents.start),
            scales : this.mbMap.options.scales,
            dpi: this.mbMap.options.dpi,
            tileSize: this.mbMap.options.tileSize
        };

        this.vectorLayer = {};
        if (!options || !options.srs || !options.maxExtent) {
            console.error("Options srs and maxExtent required");
            throw new Error("Can't initialize model");
        }
        this.options = options;

        this.viewOptions_ = this.initializeViewOptions(options);
        var view = new ol.View(this.viewOptions_);
        // remove zoom after creating view
        delete this.viewOptions_['zoom'];
        this.olMap = new ol.Map({
            view: view,
            target: this.mbMap.element.attr('id')
        });
        this.map = new Mapbender.NotMapQueryMap(this.mbMap.element, this.olMap);

        // ordered list of WMS / WMTS etc sources that provide pixel tiles
        /** @type {Array.<Mapbender.SourceModelOl4>} **/
        this.pixelSources = [];
        // OL4 happily assigns all layers a zIndex of 0, and displays them in the order added
        // we need real z indexes to enable reordering
        this.pixelSourceZOffset = 0;
        this.zoomToExtent(options.startExtent || options.maxExtent);
        this.initializeSourceLayers();
    },
    initializeSourceLayers: function() {
        var self = this;
        // Array.protoype.reverse is in-place
        // see https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Global_Objects/Array/reverse
        // Do not use .reverse on centrally shared values without making your own copy
        $.each(this.mbMap.options.layersets.slice().reverse(), function(idx, layersetId) {
            if(!Mapbender.configuration.layersets[layersetId]) {
                return;
            }
            $.each(Mapbender.configuration.layersets[layersetId].slice().reverse(), function(lsidx, defArr) {
                $.each(defArr, function(idx, sourceDef) {
                    self.addSourceFromConfig(sourceDef, false);
                });
            });
        });
    },
    /**
     * @param {Mapbender.Source|Object} sourceOrSourceDef
     * @param {boolean} [mangleIds] to rewrite sourceDef.id and all layer ids EVEN IF ALREADY POPULATED
     * @returns {object} sourceDef same ref, potentially modified
     */
    addSourceFromConfig: function(sourceOrSourceDef, mangleIds) {
        var sourceDef;
        if (sourceOrSourceDef instanceof Mapbender.Source) {
            sourceDef = sourceOrSourceDef;
        } else {
            sourceDef = Mapbender.Source.factory(sourceOrSourceDef);
        }
        if (mangleIds) {
            sourceDef.id = this.generateSourceId();
            if (typeof sourceDef.origId === 'undefined' || sourceDef.origId === null) {
                sourceDef.origId = sourceDef.id;
            }
            sourceDef.rewriteLayerIds();
        }

        if (!this.getSourcePos(sourceDef)) {
            this.sourceTree.push(sourceDef);
        }
        var projCode = this.getCurrentProjectionCode();

        sourceDef.mqlid = this.map.trackSource(sourceDef).id;
        var olLayers = sourceDef.initializeLayers(projCode);
        for (var i = 0; i < olLayers.length; ++i) {
            var olLayer = olLayers[i];
            olLayer.setVisible(false);
        }

        this._spliceLayers(sourceDef, olLayers);

        this.mbMap.fireModelEvent({
            name: 'sourceAdded',
            value: {
                added: {
                    source: sourceDef,
                    // legacy: no known consumer evaluates these props,
                    // but even if, they've historically been wrong anyway
                    // was: "before": always last source previously in list, even though
                    // the new source was actually added *after* that
                    before: null,
                    after: null
                }
            }
        });
        this._checkSource(sourceDef, true, false);
        return sourceDef;
    },
    /**
     * Returns the source's position
     */
    getSourcePos: function(source) {
        if (source) {
            for (var i = 0; i < this.sourceTree.length; i++) {
                if (this.sourceTree[i].id.toString() === source.id.toString()) {
                    return i;
                }
            }
        } else
            return null;
    },
    /**
     * Injects native layers into the map at the "natural" position for the source.
     * This supports multiple layers for the same source.
     *
     * @param {Mapbender.Source} source
     * @param {Array<ol.Layer>} olLayers
     * @private
     */
    _spliceLayers: function(source, olLayers) {
        var sourceIndex = this.sourceTree.indexOf(source);
        if (sourceIndex === -1) {
            console.error("Can't splice layers for source with unknown position", source, olLayers);
            throw new Error("Can't splice layers for source with unknown position");
        }
        var olMap = this.olMap;
        var layerCollection = olMap.getLayers();
        var afterLayer = layerCollection[0]; // hopefully, that's a base layer
        for (var s = sourceIndex - 1; s >= 0; --s) {
            var previousSource = this.sourceTree[s];
            var previousLayer = (previousSource.nativeLayers.slice(-1))[0];
            if (previousLayer && previousLayer.map === olMap) {
                afterLayer = previousLayer;
                break;
            }
        }
        var baseIndex = layerCollection.getArray().indexOf(afterLayer) + 1;
        for (var i = 0; i < olLayers.length; ++i) {
            var olLayer = olLayers[i];
            layerCollection.insertAt(baseIndex + i, olLayer);
            olLayer.mbConfig = source;
            // @todo; layer events
            //olLayer.events.register("loadstart", this, this._sourceLoadStart);
            //olLayer.events.register("tileerror", this, this._sourceLoadError);
            //olLayer.events.register("loadend", this, this._sourceLoadeEnd);
        }
    },
    /**
     * Calculates and applies layer state changes from accumulated treeOption changes in the source and (optionally)
     * 1) updates the engine layer parameters and redraws
     * 2) fires a mbmapsourcechanged event with the updated individual layer states
     * @param {Object} source
     * @param {boolean} redraw
     * @param {boolean} fireSourceChangedEvent
     */
    _checkSource: function(source, redraw, fireSourceChangedEvent) {
        var gsHandler = this.getGeoSourceHandler(source, true);
        var newStates = gsHandler.calculateLeafLayerStates(source, this.getScale());
        var changedStates = gsHandler.applyLayerStates(source, newStates);
        if (redraw) {
            var layerParams = source.getLayerParameters(newStates);
            this._resetSourceVisibility(source, layerParams);
        }
        if (fireSourceChangedEvent && Object.keys(changedStates).length) {
            this.mbMap.fireModelEvent({
                name: 'sourceChanged',
                value: {
                    changed: {
                        children: changedStates,
                        sourceIdx: {id: source.id}
                    }
                }
            });
        }
    },
    /**
     * Get the "geosource" object for given source from Mapbender.source
     * @param {OpenLayers.Layer|MapQuery.Layer|Object} source
     * @param {boolean} [strict] to throw on missing geosource object (default true)
     * @returns {*|null}
     */
    getGeoSourceHandler: function(source, strict) {
        var type = this.getMbConfig(source).type;
        var gs = Mapbender.source[type];
        if (!gs && (strict || typeof strict === 'undefined')) {
            throw new Error("No geosource for type " + type);
        }
        return gs || null;
    },
    /**
     * @param {OpenLayers.Layer.HTTPRequest|Object} source
     * @param {boolean} [initializePod] to auto-instantiate a Mapbender.Source object from plain-old-data (default true)
     * @param {boolean} [initializeLayers] to also auto-instantiate layers after instantiating Mapbender.Source (default false)
     * @return {Mapbender.Source}
     */
    getMbConfig: function(source, initializePod, initializeLayers) {
        var _s;
        var projCode;
        if (source.mbConfig) {
            // monkey-patched OpenLayers.Layer
            _s =  source.mbConfig;
        } else if (source.source) {
            // MapQuery layer
            _s = source.source;
        } else if (source.configuration && source.configuration.children) {
            _s = source;
        }
        if (_s) {
            if (initializePod || typeof initializePod === 'undefined') {
                if (!(_s instanceof Mapbender.Source)) {
                    var sourceObj = Mapbender.Source.factory(_s);
                    if (initializeLayers) {
                        projCode = projCode || this.getCurrentProjectionCode();
                        sourceObj.initializeLayers(projCode);
                    }
                    return sourceObj;
                }
            }
            return _s;
        }
        console.error("Cannot infer source configuration from given input", source);
        throw new Error("Cannot infer source configuration from given input");
    },
    /**
     * @param {Number|String} id
     * @return {Mapbender.Source|null}
     *
     * engine-agnostic
     */
    getSourceById: function(id) {
        return _.findWhere(this.sourceTree, {id: '' + id}) || null;
    },
    /**
     *
     * @param {string|Object} sourceOrId
     * @property {string} sourceOrId.id
     * @param state
     *
     * engine-agnostic
     */
    setSourceVisibility: function(sourceOrId, state) {
        var source;
        if (typeof sourceOrId === 'object') {
            if (sourceOrId instanceof Mapbender.Source) {
                source = sourceOrId;
            } else {
                source = this.getSourceById(sourceOrId.id);
            }
        } else {
            source = this.getSourceById(sourceOrId);
        }
        var newProps = {};
        var rootLayer = source.configuration.children[0];
        var state_ = state;
        if (state && !rootLayer.options.treeOptions.allow.selected) {
            state_ = false;
        }
        var rootLayerId = rootLayer.options.id;
        newProps[rootLayerId] = {
            options: {
                treeOptions: {
                    selected: state_
                }
            }
        };
        this._updateSourceLayerTreeOptions(source, newProps);
    },
    /**
     * Check if OpenLayer layer need to be redraw
     *
     * @TODO: infoLayers should be set outside of the function
     *
     * @param {Object} source
     * @param {Object} layerParams
     * @param {Array<string>} layerParams.layers
     * @param {Array<string>} layerParams.styles
     *
     * @returns {boolean}
     * @private
     */
    _resetSourceVisibility: function(source, layerParams) {
        var olLayer = this.getNativeLayer(source);
        if (!olLayer || !olLayer.map) {
            // return false;
        }
        // @todo: this is almost entirely WMS specific
        // Clean up this mess. Move application of layer params into type-specific source classes
        var targetVisibility = !!layerParams.layers.length && source.configuration.children[0].options.treeOptions.selected;
        var visibilityChanged = targetVisibility !== olLayer.getVisible();
        var layersChanged = source.checkLayerParameterChanges(layerParams);

        if (!visibilityChanged && !layersChanged) {
            return false;
        }

        if (layersChanged && olLayer.map && olLayer.map.tileManager) {
            olLayer.map.tileManager.clearTileQueue({
                object: olLayer
            });
        }
        if (!targetVisibility) {
            olLayer.setVisible(false);
            return false;
        } else {
            var newParams = {
                LAYERS: layerParams.layers,
                STYLES: layerParams.styles
            };
            if (visibilityChanged) {
                // Prevent the browser from reusing the loaded image. This is almost equivalent
                // to a forced redraw (c.f. olLayer.redraw(true)), but without the undesirable
                // side effect of loading the layer twice on first activation.
                // @see https://github.com/openlayers/ol2/blob/master/lib/OpenLayers/Layer/HTTPRequest.js#L157
                newParams['_OLSALT'] = Math.random();
            }
            // Nuking the back buffer prevents the layer from going visible with old layer combination
            // before loading the new images.
            // @todo: backbuffer interaction?
            //olLayer.removeBackBuffer();
            //olLayer.createBackBuffer();
            olLayer.getSource().updateParams(newParams);
            olLayer.setVisible(true);
            return true;
        }
    },
    getSources: function() {
        return this.sourceTree;
    },
    /**
     * @param {*} anything
     * @return {OpenLayers.Layer|null}
     */
    getNativeLayer: function(anything) {
        if (anything.getNativeLayer) {
            return anything.getNativeLayer(0);
        }
        if (anything.olLayer) {
            // MapQuery layer
            return anything.olLayer;
        }
        if (anything.CLASS_NAME && anything.CLASS_NAME.search('OpenLayers.Layer') === 0) {
            // OpenLayers.Layer (child class) instance
            return anything;
        }
        if (anything.mqlid) {
            // sourceTreeish
            return (this.map.layersList[anything.mqlid] || {}).olLayer || null;
        }
        if (anything.ollid) {
            return _.find(this.map.olMap.layers, _.matches({id: anything.ollid})) || null;
        }
        console.error("Could not find native layer for given obect", anything);
        return null;
    },
    /**
     * Old-style API to add a source. Source is a POD object that needs to be nested into an outer structure like:
     *  {add: {sourceDef: <x>}}
     *
     * @param {object} addOptions
     * @returns {object} source defnition (unraveled but same ref)
     * @deprecated, call addSourceFromConfig directly
     *
     * engine-agnostic
     */
    addSource: function(addOptions) {
        if (addOptions.add && addOptions.add.sourceDef) {
            // because legacy behavior was to always mangle / destroy / rewrite all ids, we do the same here
            return this.addSourceFromConfig(addOptions.add.sourceDef, true);
        } else {
            console.error("Unuspported options, ignoring", addOptions);
        }
    },
    /**
     * Updates the options.treeOptions within the source with new values from layerOptionsMap.
     * Always reapplies states to engine (i.e. affected layers are re-rendered).
     * Alawys fires an 'mbmapsourcechanged' event.
     *
     * @param {Object} source
     * @param {Object<string, Model~LayerTreeOptionWrapper>} layerOptionsMap
     * @private
     *
     * engine-agnostic
     */
    _updateSourceLayerTreeOptions: function(source, layerOptionsMap) {
        var gsHandler = this.getGeoSourceHandler(source);
        gsHandler.applyTreeOptions(source, layerOptionsMap);
        var newStates = gsHandler.calculateLeafLayerStates(source, this.getScale());
        var changedStates = gsHandler.applyLayerStates(source, newStates);
        var layerParams = source.getLayerParameters(newStates);
        this._resetSourceVisibility(source, layerParams);

        this.mbMap.fireModelEvent({
            name: 'sourceChanged',
            value: {
                changed: {
                    children: $.extend(true, {}, layerOptionsMap, changedStates)
                },
                sourceIdx: {id: source.id}
            }
        });
    }
};


Mapbender.Model.SourceModel = Mapbender.SourceModelOl4;
Mapbender.Model.prototype.SourceModel = Mapbender.SourceModelOl4;

Mapbender.Model.prototype.layerTypes = {
    vector: 'vectorLayer'
};


Mapbender.Model.prototype.DRAWTYPES = ['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection', 'Circle', 'Box'];

Mapbender.Model.prototype.mapElement = null;
Mapbender.Model.prototype.parseURL = function parseURL() {
};
Mapbender.Model.prototype.onMapClick = function onMapClick() {
    'use strict';
    return this;
};
Mapbender.Model.prototype.onFeatureClick = function onFeatureClick() {
    'use strict';
    return this;
};
Mapbender.Model.prototype.setLayerStyle = function setLayerStyle() {
};

/**
 * @todo is not complete yet
 *
 * @param {Object} options
 * @returns {ol.style.Style}
 */
Mapbender.Model.prototype.createStyle = function createStyle(options) {

    var style = new ol.style.Style();

    if (options['fill']) {
        var fill = new ol.style.Fill(options['fill']);
        style.setFill(fill);
    }

    if (options['stroke']) {
        var stroke = new ol.style.Stroke(options['stroke']);
        style.setStroke(stroke);
    }

    if (options['circle']) {
        var circle = new ol.style.Circle({
            radius: options['circle'].radius,
            fill: new ol.style.Fill({
                color: options['circle'].color
            }),
            stroke: new ol.style.Stroke(options['circle']['stroke'])
        });
        style.setImage(circle);
    }

    if (options['text']) {
        var text = new ol.style.Text({
            font: options['text']['font'],
            text: options['text']['text'],
            fill: new ol.style.Fill({
                color: options['text']['fill'].color
            }),
            stroke: new ol.style.Stroke(options['text']['stroke']),
            offsetY: options['text']['offsetY']
        });
        style.setText(text);
    }

    return style;
};

/**
 * @returns {string}
 */
Mapbender.Model.prototype.getCurrentProjectionCode = function getCurrentProj() {
    'use strict';
    return this.olMap.getView().getProjection().getCode();
};

/**
 * @returns {ol.proj.Projection}
 */
Mapbender.Model.prototype.getCurrentProjectionObject = function getCurrentProj() {
    'use strict';
    if(this.olMap){
        return this.olMap.getView().getProjection();
    } else {
      return new ol.proj.Projection({
          code: this.options.srs,
          extent: this.options.maxExtent
      });
    }

};

/**
 *
 * @returns {*|OpenLayers.Bounds}
 */
Mapbender.Model.prototype.getMapExtent = function getMapExtent() {
    'use strict';
    return this.olMap.getView().calculateExtent();
};

/** @todo (following methods): put the "default" dpi in a common place? */
/**
 *
 * @param {number} dpi default this.map.options.dpi
 * @param {boolean} optRound Whether to round the scale or not.
 * @param {boolean} optScaleRating Whether to round the scale rating or not. K:X000 and M:X000000
 * @returns {number}
 */
Mapbender.Model.prototype.getScale = function getScale(dpi, optRound, optScaleRating) {
    var dpiNumber = dpi ? dpi : this.options.dpi;
    var resolution = this.olMap.getView().getResolution();
    var scaleCalc = this.resolutionToScale(resolution, dpiNumber);
    var scale = optRound ? Math.round(scaleCalc) : scaleCalc;

    if (optScaleRating){
        if (scale >= 10 && scale <= 1000) {
            scale = Math.round(scale/ 10) + "0";
        } else if (scale >= 1000 && scale <= 9500) {
            scale = Math.round(scale/ 100) + "00";
        } else if(scale >= 9500 && scale <= 950000) {
            scale = Math.round(scale/ 1000) + "000";
        } else if (scale >= 950000) {
            scale = Math.round(scale / 1000000) + "000000";
        } else {
            scale = Math.round(scale);
        }
    }

    scale = typeof scale ? parseFloat(scale) : scale;

    return scale;
};

/**
 *
 * @param {float} resolution
 * @param {number} [dpi=72]
 * @param {string} unit "m" or "degrees"
 * @returns {number}
 */
Mapbender.Model.prototype.resolutionToScale = function(resolution, dpi) {
    var currentUnit = this.getUnitsOfCurrentProjection();
    var mpu = this.getMetersPerUnit(currentUnit);
    var inchesPerMetre = 39.37;
    return resolution * mpu * inchesPerMetre * (dpi || this.options.dpi || 72);
};

/**
 * @param {float} scale
 * @param {number} dpi
 * @param {string} unit
 * @returns {number}
 */
Mapbender.Model.scaleToResolutionStatic = function(scale, dpi, unit) {
    if (!dpi || !unit) {
        console.error("Must supply dpi and unit", scale, dpi, unit);
        throw new Error("Must supply dpi and unit");
    }
    var mpu = this.getMetersPerUnit(unit);
    var inchesPerMetre = 39.37;
    return scale / (mpu * inchesPerMetre * dpi);
};
// make available on instance
Mapbender.Model.prototype.scaleToResolutionStatic = Mapbender.Model.scaleToResolutionStatic;

/**
 *
 * @param {float} scale
 * @param {number} [dpi]
 * @returns {number}
 */
Mapbender.Model.prototype.scaleToResolution = function(scale, dpi) {
    var currentUnit = this.getUnitsOfCurrentProjection();
    return this.scaleToResolutionStatic(scale, dpi || this.options.dpi || 72, currentUnit);
};

/**
 *
 * @param {float} scale
 * @param {number} [dpi]
 * @returns {number}
 */
Mapbender.Model.prototype.scaleToZoom = function(scale, dpi) {
    var resolution = this.scaleToResolution(scale, dpi);
    return this.olMap.getView().getZoomForResolution(resolution);
};

/**
 *
 * @param {float} scale
 * @param {number} [dpi]
 * @returns {number}
 */
Mapbender.Model.prototype.setScale = function(scale, dpi) {
    this.olMap.getView().setZoom(this.scaleToZoom(scale, dpi));
};


Mapbender.Model.prototype.center = function center() {
};

Mapbender.Model.prototype.removeSource = function removeSource() {
};
Mapbender.Model.prototype.setLayerOpacity = function setLayerOpacity() {
};
Mapbender.Model.prototype.changeProjection = function changeProjection() {
};

/**
 * @type {number}
 * @static
 * @private
 */
Mapbender.Model.nextGeneratedSourceId_ = 1;

/**
 * Generate a string id for a source that doesn't have one. Preconfigured sources
 * (application backend: "Layersets") always have an id. Sources supplied dynamically
 * by WmsLoader and / or WmcHandler might not.
 *
 * @returns {string}
 * @static
 */
Mapbender.Model.generateSourceId = function generateSourceId() {
    return "src-autoid-" + (Mapbender.Model.nextGeneratedSourceId_++);
};
Mapbender.Model.prototype.generateSourceId = Mapbender.Model.generateSourceId;

/**
 * @param {Object} options (See https://openlayers.org/en/latest/apidoc/ol.layer.Vector.html)
 * @param {ol.style|function} options.style (See https://openlayers.org/en/latest/apidoc/ol.style.Style.html)
 * @param {string} owner
 * @returns {string}
 */
Mapbender.Model.prototype.createVectorLayer = function(options, owner) {
    'use strict';
    var uuid = Mapbender.UUID();
    this.vectorLayer[owner] = this.vectorLayer[owner] || {};
    options.map = this.olMap;
    options.style = options.style ? this.createVectorLayerStyle(options.style) : this.createVectorLayerStyle();
    this.vectorLayer[owner][uuid] = new ol.layer.Vector(options);

    return uuid;
};

/**
 *
 * @param array
 * @param deltaArray
 * @returns {ol.coordinate.add}
 */
Mapbender.Model.prototype.addCoordinate= function addCoordinate(array, deltaArray) {
    'use strict';

    if (!deltaArray) {
        deltaArray = [0, 0];
    }

    return new ol.coordinate.add(array, deltaArray);
};

/**
 *
 * @param coordinate
 * @param source
 * @param destination
 * @returns {ol.Coordinate}
 */

Mapbender.Model.prototype.transformCoordinate = function transformCoordinate(coordinate, source, destination) {
    'use strict';
    return ol.proj.transform(coordinate, source, destination);
};

/**
 *
 * @param coordinate
 * @param opt_projection
 * @returns {ol.Coordinate}
 */
Mapbender.Model.prototype.toLonLat = function toLonLat(coordinate, opt_projection) {
    'use strict';
    return ol.proj.toLonLat(coordinate,opt_projection);
};

/**
 *
 * @param owner
 * @returns {*}
 */
Mapbender.Model.prototype.getVectorLayerByNameId = function getVectorLayerByNameId(owner, id) {
    'use strict';
    var vectorLayer = this.vectorLayer;
    return  vectorLayer[owner][id];
};

/**
 *
 * @param owner
 * @param featuresArray
 */
Mapbender.Model.prototype.addFeaturesVectorSource = function addFeaturesVectorSource(owner,featuresArray) {
    'use strict';
    var vectorLayer = this.vectorLayer[owner];
    var vectorSource = new ol.source.Vector({
        features: featuresArray
    });
    vectorLayer.setSource(vectorSource);

};

/**
 *
 * @param center
 * @returns {*|void}
 */
Mapbender.Model.prototype.setCenter = function setCenter(center) {
    'use strict';
    return this.olMap.getView().setCenter(center);
};

/**
 *
 * @param zoom
 * @returns {*}
 */
Mapbender.Model.prototype.setZoom = function setZoom(zoom) {
    'use strict';
    return this.olMap.getView().setZoom(zoom);
};

/**
 *
 * @param geometryOrExtent
 * @param opt_options
 * @returns {*}
 */
Mapbender.Model.prototype.fit = function fit(geometryOrExtent, opt_options) {
    'use strict';
    return this.olMap.getView().fit(geometryOrExtent, opt_options);
};

/**
 *
 * @param extent1
 * @param extent2
 * @returns {*|boolean}
 */
Mapbender.Model.prototype.containsExtent = function containsExtent(extent1, extent2) {
    'use strict';
    return ol.extent.containsExtent(extent1, extent2);
};

/**
 *
 * @param extent
 * @param coordinate
 * @returns {*}
 */
Mapbender.Model.prototype.containsCoordinate = function containsCoordinate(extent, coordinate) {
    'use strict';
    return ol.extent.containsCoordinate(extent, coordinate);
};

/**
 * fit to Extent
 * @param extent
 * @param {array} optOptions
 */
Mapbender.Model.prototype.panToExtent = function panToExtent(extent, optOptions) {
    'use strict';

    var view = this.olMap.getView();
    var size = optOptions['size'] ? optOptions['size']: undefined;
    var padding =  optOptions['padding'] ?optOptions['padding']: undefined;
    var constrainResolution =  optOptions['constrainResolution'] ?optOptions['constrainResolution']: undefined;
    var nearest =  optOptions['nearest'] ?optOptions['nearest']: undefined;
    var minResolution =  optOptions['minResolution'] ?optOptions['minResolution']: undefined;
    var easing =  optOptions['easing'] ?optOptions['easing']: undefined;
    var callback =  optOptions['callback'] ?optOptions['callback']: undefined;
    var maxZoom= optOptions['maxZoom'] ? optOptions['maxZoom']: view.getZoom();
    var duration = optOptions['duration'] ? optOptions['duration'] : 0;

    view.fit(extent, {
        size: size,
        paddig:padding,
        constrainResolution: constrainResolution,
        nearest: nearest,
        minResolution: minResolution,
        easing:easing,
        callback: callback,
        duration: duration,
        maxZoom: maxZoom
    });
};

/**
 *
 * @param mbExtent
 * @return {Mapbender.Model}
 */
Mapbender.Model.prototype.zoomToExtent = function(mbExtent) {
    'use strict';
    var extent = [
        mbExtent.left,
        mbExtent.bottom,
        mbExtent.right,
        mbExtent.top
    ];
    this.olMap.getView().fit(extent, this.olMap.getSize());

    return this;
};

/**
 *
 * @param coordinate
 * @returns {ol.Extent}
 */
Mapbender.Model.prototype.boundingExtentFromCoordinates = function boundingExtentFromCoordinates(coordinate) {
    'use strict';
    return ol.extent.boundingExtent(coordinate);
};

/**
 *
 * @returns {*}
 */
Mapbender.Model.prototype.getLayers = function getLayers() {
    'use strict';
    return this.olMap.getLayers();
};

/**
 *
 * @param owner
 * @param uuid
 * @param style
 * @param refresh
 */
Mapbender.Model.prototype.setVectorLayerStyle = function setVectorLayerStyle(owner, uuid, style, refresh){
    'use strict';
    this.setLayerStyle('vectorLayer', owner, uuid, style);
};

/**
 *
 * @param layerType
 * @param owner
 * @param uuid
 * @param style
 * @param refresh
 */
Mapbender.Model.prototype.setLayerStyle = function setLayerStyle(layerType, owner, uuid, style, refresh){
    'use strict';
    this.vectorLayer[owner][uuid].setLayerStyle(new ol.style.Style(style));
    if(refresh){
        this.vectorLayer[owner][uuid].refresh();
    }

};
Mapbender.Model.prototype.createDrawControl = function createDrawControl(type, owner, options){
    'use strict';

    if(!_.contains( this.DRAWTYPES,type )){
        throw new Error('Mapbender.Model.createDrawControl only supports the operations' + this.DRAWTYPES.toString()+ 'not' + type);
    }
    options = options || {};
    options.source = options.source ||  new ol.source.Vector({wrapX: false});

    var drawOptions = {
        type: type,
        source: options.source
    };
    var id = this.createVectorLayer(options, owner);

    if (type === 'Box') {
        drawOptions.geometryFunction = ol.interaction.Draw.createBox();
        drawOptions.type = 'Circle';
    }

    var draw = new ol.interaction.Draw(drawOptions);

    this.vectorLayer[owner][id].interactions = this.vectorLayer[owner][id].interactions || {};
    this.vectorLayer[owner][id].interactions[id] = draw;


    _.each(options.events, function(value, key) {
        draw.on(key, value);
    }.bind(this));

    this.olMap.addInteraction(draw);

    return id;

};

Mapbender.Model.prototype.createModifyInteraction = function createModifyInteraction(owner, style, vectorId, featureId, events) {
    'use strict';

    var vectorLayer = this.vectorLayer[owner][vectorId];
    var features = vectorLayer.getSource().getFeatures();
    var selectInteraction = new ol.interaction.Select({
        layers: vectorLayer,
        style: style
    });
    selectInteraction.getFeatures().push(features[0]);

    this.vectorLayer[owner][vectorId].interactions = this.vectorLayer[owner][vectorId].interactions  || {};
    this.vectorLayer[owner][vectorId].interactions.select = this.vectorLayer[owner][vectorId].interactions.select  || {};
    this.vectorLayer[owner][vectorId].interactions.select[vectorId] = selectInteraction;

    var modify = new ol.interaction.Modify({
        features: selectInteraction.getFeatures()
    });

    this.vectorLayer[owner][vectorId].interactions = this.vectorLayer[owner][vectorId].interactions  || {};
    this.vectorLayer[owner][vectorId].interactions[vectorId] = modify;

    _.each(events, function(value, key) {
        modify.on(key, value);
    }.bind(this));

    this.olMap.getInteractions().extend([selectInteraction, modify]);

    return vectorId;
};

Mapbender.Model.prototype.deselectFeatureById = function deselectFeatureById(owner, vectorId) {
    'use strict';
    var vectorLayer = this.vectorLayer[owner][vectorId];
    if (!vectorLayer.interactions.select) {
        return;
    }
    var interaction = vectorLayer.interactions.select[vectorId];
    interaction.getFeatures().clear();
};

Mapbender.Model.prototype.removeVectorLayer = function removeVectorLayer(owner,id){
    var vectorLayer = this.vectorLayer[owner][id];
    if(this.vectorLayer[owner][id].hasOwnProperty('interactions')){
        this.removeInteractions(this.vectorLayer[owner][id].interactions);
    }
    this.olMap.removeLayer(vectorLayer);
    delete this.vectorLayer[owner][id];


};

Mapbender.Model.prototype.removeInteractions = function removeControls(controls){
    _.each(controls, function(control, index){
        this.olMap.removeInteraction(control);
    }.bind(this));


};

Mapbender.Model.prototype.eventFeatureWrapper = function eventFeatureWrapper(event, callback, args){
    'use strict';
    var args = [event.feature].concat(args)
    return callback.apply(this,args);

};



Mapbender.Model.prototype.getLineStringLength = function(line){
    'use strict';

    return  ol.Sphere.getLength(line);
};

Mapbender.Model.prototype.onFeatureChange = function(feature, callback,obvservable, args){
    'use strict';

    return feature.getGeometry().on('change', function(evt) {
        var geom = evt.target;
        args = [geom].concat(args);
        obvservable.value =  callback.apply(this,args);
    });


};


/**
 * Create olDefaultStyle or olCustomStyle
 * @param {array} optOptions params from ol.style.Style.
 * @returns {ol.style.Style}
 */
Mapbender.Model.prototype.createVectorLayerStyle = function createVectorLayerStyle(optOptions){
    var olStyle = null;
    if (optOptions){
        olStyle = this.getCustomStyle(optOptions);
    }else{
        var fill = new ol.style.Fill({
            color: 'rgba(255,255,255,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: '#3399CC',
            width: 1.25
        });

        olStyle= new ol.style.Style({
            fill: fill,
            stroke: stroke
        });
    }

    return olStyle;
};

/**
 *
 * @returns {Array.<Mapbender.SourceModelOl4>}
 */
Mapbender.Model.prototype.getActiveSources = function() {
    var sources = [];
    for (var i = 0; i < this.pixelSources.length; ++i) {
        var source = this.pixelSources[i];
        if (source.isActive()) {
            sources.push(source);
        }
    }
    return sources;
};

/**
 * @returns {string[]}
 */
Mapbender.Model.prototype.getActiveSourceIds = function() {
    return this.getActiveSources().map(function(source) {
        /** @var {Mapbender.SourceModelOl4} source */
        return source.id;
    });
};

/**
 * @returns {string[]}
 * @param sourceId
 */
Mapbender.Model.prototype.getActiveLayerNames = function(sourceId) {
    return this.getSourceById(sourceId).getActiveLayerNames();
};

/**
 *
 * @param owner
 * @param vectorId
 * @param featureId
 * @returns {ol.Feature}
 */
Mapbender.Model.prototype.getFeatureById = function(owner, vectorId, featureId) {
    'use strict';
    var source = this.vectorLayer[owner][vectorId].getSource();
    return source.getFeatureById(featureId);
};

/**
 *
 * @param owner
 * @param vectorId
 * @param featureId
 */
Mapbender.Model.prototype.removeFeatureById = function(owner, vectorId, featureId) {
    'use strict';
    var source = this.vectorLayer[owner][vectorId].getSource();
    var feature = source.getFeatureById(featureId);
    source.removeFeature(feature);
};

/**
 *
 * @param owner
 * @param vectorId
 */
Mapbender.Model.prototype.getLayerExtent = function(owner, vectorId) {
    'use strict';
    var vectorLayerExtent = this.vectorLayer[owner][vectorId].getSource().getExtent();
    return this.mbExtent(vectorLayerExtent);
};

/**
 *
 * @param owner
 * @param vectorId
 * @param featureId
 */
Mapbender.Model.prototype.getFeatureExtent = function(owner, vectorId, featureId) {
    'use strict';
    var feature = this.getFeatureById(owner, vectorId, featureId);
    var featureExtent = feature.getGeometry().getExtent();
    return this.mbExtent(featureExtent);
};

/**
 * Promote input extent into "universally understood" extent.
 *
 * Monkey-patch attributes 'left', 'bottom', 'right', 'top' onto
 * a coordinate array, or convert a pure object extent with those
 * attributes into a monkey-patched Array of numbers.
 *
 * Also force coordinate values to float.
 *
 * @param {(Array.<number>|Object.<string, number>)} extent
 * @returns {Array.<number>}
 * @static
 */
Mapbender.Model.mbExtent = function mbExtent(extent) {
    'use strict';
    if (Array.isArray(extent)) {
        if (extent.length !== 4) {
            console.error("Extent coordinate length mismatch", extent);
            throw new Error("Extent coordinate length mismatch");
        }
        if (typeof extent.left !== 'undefined') {
            // already patched, return same object (idempotence, no copy)
            return extent;
        }
        _.each(["left","bottom", "right","top"], function(value, index){
            extent[index] = parseFloat(extent[index]);
            extent[value] = extent[index];
        });
        return extent;
    } else if (typeof extent.left !== 'undefined') {
        return Mapbender.Model.mbExtent([
            extent.left,
            extent.bottom,
            extent.right,
            extent.top
            ]);
    } else {
        console.error("Unsupported extent format", extent);
        throw new Error("Unsupported extent format");
    }
};
Mapbender.Model.prototype.mbExtent = Mapbender.Model.mbExtent;

/**
 *
 * @param mbExtent
 */
Mapbender.Model.prototype.zoomToExtent = function(extent) {
    'use strict';
    this.olMap.getView().fit(this.mbExtent(extent), this.olMap.getSize());
};

Mapbender.Model.prototype.removeAllFeaturesFromLayer = function removeAllFeaturesFromLayer(owner, id) {

    return this.vectorLayer[owner][id].getSource().clear();

};

Mapbender.Model.prototype.getFeatureSize = function getFeatureSize(feature, type) {

    if(type === 'line'){
        return this.getLineStringLength(feature);
    }
    if(type === 'area'){
        return   this.getPolygonArea(feature);
    }





};

Mapbender.Model.prototype.getGeometryCoordinates = function getFeaureCoordinates(geom) {

    return geom.getFlatCoordinates();

};





Mapbender.Model.prototype.getPolygonArea = function getPolygonArea(polygon){
    'use strict';

    return  ol.Sphere.getArea(polygon);
};

Mapbender.Model.prototype.getGeometryFromFeatureWrapper = function getGeometryFromFeatureWrapper(feature, callback, args){
    'use strict';
    args = [feature.getGeometry()].concat(args)
    return callback.apply(this,args);

};

/**
 * Get feature info url and source object; may return null if feature info is not available.
 *
 * @param {string} sourceId
 * @param {*} coordinate in current EPSG
 * @param {*} resolution purpose?
 * @returns {object|null}
 */
Mapbender.Model.prototype.getFeatureInfoObject = function getFeatureInfoObject(sourceId, coordinate, resolution) {
    var sourceObj = this.getSourceById(sourceId);

    if (!sourceObj.featureInfoParams.QUERY_LAYERS) {
        return null;
    }

    var sourceObjParams = sourceObj.featureInfoParams;
    /** @var {ol.source.ImageWMS|ol.source.TileWMS} engineSource */
    var engineSource = sourceObj.getEngineSource();
    var projection = this.getCurrentProjectionCode();

    // @todo: figure out the purpose of 'resolution' param

    var result = {
        url: engineSource.getGetFeatureInfoUrl(coordinate[0] || [0, 0], resolution || 5, projection, sourceObjParams),
        source: sourceObj
    };

    return result;
};

/**
 * Collects feature info URLs and source object from all active sources
 *
 * @todo: add resolution params
 *
 * @returns {object[]}
 */
Mapbender.Model.prototype.collectFeatureInfoObjects = function collectFeatureInfoObjects(coordinate) {
    var urls = [];
    var sourceIds = this.getActiveSourceIds();
    for (var i = 0; i < sourceIds.length; ++i) {
        // pass sourceId, forward all remaining arguments
        // @todo: remove this argument-forwarding style once the API has settled
        urls.push(this.getFeatureInfoObject.apply(this, [sourceIds[i]].concat(arguments)));
    }
    // strip nulls
    return _.filter(urls);
};

Mapbender.Model.prototype.createTextStyle = function createTextStyle(options) {
    'use strict';

    var textStyle = new ol.style.Text();

    if(options['text']) {
        var text = new ol.style.Text(options['text']);
        textStyle.setText(text);
    }

    if(options['fill']) {
        var fill = new ol.style.Fill(options['fill']);
        textStyle.setFill(fill);
    }

    if(options['stroke']) {
        var stroke = new ol.style.Stroke(options['stroke']);
        textStyle.setStroke(stroke);
    }
    return new ol.style.Text(options);
};

    /**
     * Update map view according to selected projection
     *
     * @param {string} projectionCode
     */
    Mapbender.Model.prototype.updateMapViewForProjection = function(projectionCode) {
        var currentSrsCode = this.getCurrentProjectionCode();

        if(typeof projectionCode === 'undefined' || projectionCode === currentSrsCode) {
            return;
        }
        var currentView = this.olMap.getView();
        var fromProj = ol.proj.get(currentSrsCode);
        var toProj = ol.proj.get(projectionCode);
        if (!fromProj || !fromProj.getUnits() || !toProj || !toProj.getUnits()) {
            console.error("Missing / incomplete transformations (log order from / to)", [currentSrsCode, projectionCode], [fromProj, toProj]);
            throw new Error("Missing / incomplete transformations");
        }
        for (var i = 0; i < this.pixelSources.length; ++i) {
            this.pixelSources[i].updateSrs(toProj);
        }
        // viewProjection.getUnits() may return undefined, safer this way!
        var currentUnits = fromProj.getUnits() || "degrees";
        var newUnits = toProj.getUnits() || "degrees";
        // transform projection extent (=max extent)
        // DO NOT use currentView.getProjection().getExtent() here!
        // Going back and forth between SRSs, there is extreme drift in the
        // calculated values. Always start from the configured maxExtent.
        var newMaxExtent = ol.proj.transformExtent(this.options.maxExtent, this.options.srs, toProj);

        var viewPortSize = this.olMap.getSize();
        var currentCenter = currentView.getCenter();
        var newCenter = ol.proj.transform(currentCenter, fromProj, toProj);

        var newProjection = ol.proj.get(projectionCode);
        newProjection.setExtent(newMaxExtent);

        // Recalculate resolution and allowed resolution steps
        var _convertResolution = this.convertResolution_.bind(undefined, currentUnits, newUnits);
        var newResolution = _convertResolution(currentView.getResolution());
        var newResolutions = this.viewOptions_.resolutions.map(_convertResolution);
        // Amend this.viewOptions_, we need the applied values for the next SRS switch
        var newViewOptions = $.extend(this.viewOptions_, {
            projection: newProjection,
            resolutions: newResolutions,
            center: newCenter,
            size: viewPortSize,
            resolution: newResolution
        });

        var newView = new ol.View(newViewOptions);
        this.olMap.setView(newView);
    };

/**
 * Set callback function for single click event
 *
 * @param callback
 * @returns {ol.EventsKey|Array.<ol.EventsKey>}
 */
Mapbender.Model.prototype.setOnSingleClickHandler = function (callback) {
    'use strict';
    return this.olMap.on("singleclick", callback);
};

/**
 * Set callback for map moveend event
 * @param callback
 * @returns {ol.EventsKey|Array<ol.EventsKey>}
 */
Mapbender.Model.prototype.setOnMoveendHandler = function (callback) {
    'use strict';

    if (typeof callback === 'function') {
        return this.olMap.on("moveend", callback);
    }
};

/**
 * Remove event listener by event key
 *
 * @param key
 * @returns {Mapbender.Model}
 */
Mapbender.Model.prototype.removeEventListenerByKey = function (key) {
    ol.Observable.unByKey(key);

    return this;
};

/**
 * Get coordinates from map click event and wrap them in {x,y} object
 *
 * @param event
 * @returns undefined | {{x}, {y}}
 */
Mapbender.Model.prototype.getCoordinatesXYObjectFromMapClickEvent = function (event) {

    var coordinates = undefined;

    if (typeof event.coordinate !== 'undefined') {
        coordinates = {
            x: event.coordinate[0],
            y: event.coordinate[1],
        };
    }

    return coordinates;
};

/**
 * Get units of current map projection
 *
 * @returns {ol.proj.Units}
 */
Mapbender.Model.prototype.getUnitsOfCurrentProjection = function () {
    var proj = this.getCurrentProjectionObject();
    var units = proj.getUnits();
    if (!units) {
        console.warn("Projection object has undefined units! Defaulting to degrees", proj);
        units = "degrees";
    }
    return units;
};

/**
 * Set style of map cursor
 *
 * @param style
 * @returns {Mapbender.Model}
 */
Mapbender.Model.prototype.setMapCursorStyle = function (style) {
    this.olMap.getTargetElement().style.cursor = style;

    return this;
};

/**
 * Set marker on a map by provided coordinates
 *
 * @param {string[]} coordinates
 * @param {string} owner Element id
 * @param {string} vectorLayerId
 * @param {ol.style} style
 * @returns {string} vectorLayerId
 */
Mapbender.Model.prototype.setMarkerOnCoordinates = function (coordinates, owner, vectorLayerId, style) {

    if (typeof coordinates === 'undefined') {
        throw new Error("Coordinates are not defined!");
    }

    var point = new ol.geom.Point(coordinates);

    if (typeof vectorLayerId === 'undefined' || null === vectorLayerId) {

        vectorLayerId = this.createVectorLayer({
            source: new ol.source.Vector({wrapX: false}),
        }, owner);

        this.olMap.addLayer(this.vectorLayer[owner][vectorLayerId]);
    }

    this.drawFeatureOnVectorLayer(point, this.vectorLayer[owner][vectorLayerId], style);

    return vectorLayerId;
};

/**
 * Draw feature on a vector layer
 *
 * @param {ol.geom} geometry
 * @param {ol.layer.Vector} vectorLayer
 * @param {ol.style} style
 * @returns {Mapbender.Model}
 */
Mapbender.Model.prototype.drawFeatureOnVectorLayer = function (geometry, vectorLayer, style) {
    var feature = new ol.Feature({
        geometry: geometry,
    });

    feature.setStyle(style);

    var source = vectorLayer.getSource();

    source.addFeature(feature);

    return this;
};

/**
 * Valdiates and fixes an incoming extent. Coordinate values will
 * be cast to float. Inverted coordinates are flipped.
 *
 * @param extent
 * @returns {Array<number>} monkey-patched mbExtent with .left etc
 * @static
 */
Mapbender.Model.sanitizeExtent = function(extent) {
    var mbExtent = this.mbExtent(extent);
    var warnings = [];
    for (var i = 0; i < mbExtent.length; ++i) {
        if (isNaN(mbExtent[i])) {
            console.error("Extent contains NaNs", mbExtent);
            throw new Error("Extent contains NaNs");
        }
    }
    if (mbExtent[0] > mbExtent[2]) {
        warnings.push("left > right");
    }
    if (mbExtent[1] > mbExtent[3]) {
        warnings.push("bottom > top");
    }
    if (warnings.length) {
        console.warn("Fixing flipped extent coordinates " + warnings.join(","), mbExtent);
        var left = Math.min(mbExtent[0], mbExtent[2]);
        var right = Math.max(mbExtent[0], mbExtent[2]);
        var bottom = Math.min(mbExtent[1], mbExtent[3]);
        var top = Math.max(mbExtent[1], mbExtent[3]);
        return this.mbExtent([left, bottom, right, top]);
    } else {
        return mbExtent;
    }
};
Mapbender.Model.prototype.sanitizeExtent = Mapbender.Model.sanitizeExtent;

/**
 * Return current live extent in "universal extent" format
 * + monkey-patched attribute 'srs'
 *
 * @returns {Array<number>|*}
 */
Mapbender.Model.prototype.getCurrentExtent = function getCurrentExtent() {
    var extent = this.mbExtent(this.olMap.getView().calculateExtent());
    extent.srs = this.getCurrentProjectionCode();
    return extent;
};

/**
 * Return maximum extent in "universal extent" format
 * + monkey-patched attribute 'srs'
 *
 * @returns {Array<number>|*}
 */
Mapbender.Model.prototype.getMaxExtent = function getMaxExtent() {
    var extent = this.mbExtent(this.getCurrentProjectionObject().getExtent());
    extent.srs = this.getCurrentProjectionCode();
    return extent;
};

/**
 *
 * @param currentUnit
 * @static
 * @returns {number}
 */
Mapbender.Model.prototype.getMetersPerUnit = function getMetersPerUnit(currentUnit) {
    'use strict';
    return ol.proj.METERS_PER_UNIT[currentUnit];
};
Mapbender.Model.getMetersPerUnit = Mapbender.Model.prototype.getMetersPerUnit;


Mapbender.Model.prototype.getGeomFromFeature = function getGeomFromFeature(feature) {
    'use strict';
    return feature.getGeometry();
};

/**
 * Returns the size of the map in the DOM (in pixels):
 * An array of numbers representing a size: [width, height].
 * @returns {Array.<number>}
 */
Mapbender.Model.prototype.getMapSize = function getMapSize() {
    'use strict';
    return this.olMap.getSize();
};

/**
 * Returns the view center of a map:
 * An array of numbers representing an xy coordinate. Example: [16, 48].
 * @returns {Array.<number>}
 */
Mapbender.Model.prototype.getMapCenter = function getMapCenter() {
    'use strict';
    return this.olMap.getView().getCenter();
};

/**
 * Returns the width of an extent.
 * @param extent
 * @returns {number}
 */
Mapbender.Model.prototype.getWidthOfExtent = function getWidthOfExtent(extent) {
    'use strict';
    return ol.extent.getWidth(extent);
};

/**
 * Returns the height of an extent.
 * @param {Array} extent
 * @returns {number}
 */
Mapbender.Model.prototype.getHeigthOfExtent = function getHeigthOfExtent(extent) {
    'use strict';
    return ol.extent.getHeight(extent);
};

/**
 * @param {Object} params
 * @returns {string}
 */
Mapbender.Model.prototype.getUrlParametersAsString = function getUrlParametersAsString(params) {
    'use strict';
    var url = '';
    for (var key in params) {
        if (params.hasOwnProperty(key)) {
            url += '&' + key + '=' + params[key];
        }
    }

    return url;
};

/**
 * @param {string} sourceId
 * @param {Array} extent
 * @param {Array} size
 * @returns {{type: (string|null), url: string, opacity}}
 */
Mapbender.Model.prototype.getSourcePrintConfig = function(source, extent, size) {
    var sourceObj = this.toSourceObj_(source);

    // Contains VERSION, FORMAT, TRANSPARENT, LAYERS
    var params = sourceObj.getMapParams;  //engineSource.getParams();

    var v13 = false;
    if (params.VERSION.indexOf('1.3') !== -1) {
        v13 = true;
    }

    // To ensure that only active layers are considered.
    params.LAYERS = sourceObj.getActiveLayerNames().join(',');

    params.REQUEST = 'GetMap';
    params.SERVICE = sourceObj.getType().toUpperCase();
    params.STYLES = ''; //@todo always empty or should it be possible to assign them from a config?


    params[v13 ? 'CRS' : 'SRS'] = this.getCurrentProjectionCode();

    var bbox;
    var axisOrientation = this.getCurrentProjectionObject().getAxisOrientation();
    if (v13 && axisOrientation.substr(0, 2) === 'ne') {
        bbox = [extent[1], extent[0], extent[3], extent[2]];
    } else {
        bbox = extent;
    }
    params.BBOX = bbox.join(',');

    params.WIDTH = size[0];
    params.HEIGHT = size[1];

    // base url contains the ? sign already.
    var url = sourceObj.getBaseUrl();
    url += this.getUrlParametersAsString(params);

    return {
        type : sourceObj.getType(),
        url : url,
        opacity : sourceObj.options.opacity
    };
}

/**
 * @returns {ol.format.GeoJSON}
 */
Mapbender.Model.prototype.createOlFormatGeoJSON = function createOlFormatGeoJSON() {
    'use strict';
    return new ol.format.GeoJSON;
};

/**
 * Returns the features of the vectorLayers hashed by owner and uuid.
 * @returns {object.<string>.<string>.<Array.<ol.Feature>>}
 */
Mapbender.Model.prototype.getVectorLayerFeatures = function getVectorLayerFeatures() {
    'use strict';
    var features = {};
    for (var owner in this.vectorLayer) {
        for (var uuid in this.vectorLayer[owner]) {
            var vectorLayer = this.vectorLayer[owner][uuid];
            if (!vectorLayer instanceof ol.layer.Vector) {
                continue;
            }

            if (!features[owner]) {
                features[owner] = {};
            }

            features[owner][uuid] = vectorLayer.getSource().getFeatures();
        }
    }

    return features;
};

/**
 * Returns the styles of the vectorLayers hashed by owner and uuid.
 * @returns {object.<string>.<string>.<ol.style.Style>}
 */
Mapbender.Model.prototype.getVectorLayerStyles = function getVectorLayerStyles() {
    'use strict';
    var styles = {};
    for (var owner in this.vectorLayer) {
        for (var uuid in this.vectorLayer[owner]) {
            var vectorLayer = this.vectorLayer[owner][uuid];
            if (!vectorLayer instanceof ol.layer.Vector) {
                continue;
            }

            if (!styles[owner]) {
                styles[owner] = {};
            }

            styles[owner][uuid] = vectorLayer.getStyle();
        }
    }

    return styles;
};

/**
 * Returns the print style options of the vectorLayers hashed by owner and uuid.
 * @returns {Object.<string>.<string>.<object>}
 */
Mapbender.Model.prototype.getVectorLayerPrintStyleOptions = function getVectorLayerPrintStyleOptions() {
    'use strict';
    var olVectorLayerStyles = this.getVectorLayerStyles();

    var allStyleOptions = {};

    for (var owner in olVectorLayerStyles) {
        for (var uuid in olVectorLayerStyles[owner]) {
            var olStyle = olVectorLayerStyles[owner][uuid];

            if (!olStyle instanceof ol.style.Style) {
                continue;
            }

            var styleOptions = {};

            // fill things.
            var colorAndOpacityObjectFill = this.getHexNormalColorAndOpacityObject(olStyle.getFill().getColor());
            styleOptions['fillColor'] = colorAndOpacityObjectFill.color;
            styleOptions['fillOpacity'] = colorAndOpacityObjectFill.opacity;

            // fill hover things.
            styleOptions['hoverFillColor'] = 'white';
            styleOptions['hoverFillOpacity'] = 0.8;

            // stroke things.
            var colorAndOpacityObjectStroke = this.getHexNormalColorAndOpacityObject(olStyle.getStroke().getColor());
            styleOptions['strokeColor'] = colorAndOpacityObjectStroke.color;
            styleOptions['strokeOpacity'] = colorAndOpacityObjectStroke.opacity;
            styleOptions['strokeWidth'] = olStyle.getStroke().getWidth();

            var strokeLinecap = olStyle.getStroke().getLineCap();
            styleOptions['strokeLinecap'] = strokeLinecap ? strokeLinecap : 'round';

            var strokeDashstyle = olStyle.getStroke().getLineDash();
            styleOptions['strokeDashstyle'] = strokeDashstyle ? strokeDashstyle : 'solid';


            // hover things.
            styleOptions['hoverStrokeColor'] = 'red';
            styleOptions['hoverStrokeOpacity'] = 1;
            styleOptions['hoverStrokeWidth'] = 0.2;
            styleOptions['pointRadius'] = 6;
            styleOptions['hoverPointRadius'] = 1;
            styleOptions['hoverPointUnit'] = '%';
            styleOptions['pointerEvents'] = 'visiblePainted';
            styleOptions['cursor'] = 'inherit';


            // font/label things.
            var fontColor = olStyle.getText().getFill().getColor();
            if (fontColor) {
                var colorAndOpacityObjectFontColor = this.getHexNormalColorAndOpacityObject(olStyle.getText().getFill().getColor());
                styleOptions['fontColor'] = colorAndOpacityObjectFontColor.color;

            } else {
                styleOptions['fontColor'] = '#000000';
            }

            var labelAlign = olStyle.getText().getTextAlign();
            styleOptions['labelAlign'] = labelAlign ? labelAlign : 'cm';

            styleOptions['labelOutlineColor'] = 'white';
            styleOptions['labelOutlineWidth'] = 3;


            if (!allStyleOptions[owner]) {
                allStyleOptions[owner] = {};
            }

            allStyleOptions[owner][uuid] = styleOptions;
        }
    }

    return allStyleOptions;
};

/**
 * Returns an object with color and opacity. If the color is in rgb or rgba form, it will be converted
 * into a hex string.
 * @param {string} color
 * @returns {object}
 */
Mapbender.Model.prototype.getHexNormalColorAndOpacityObject = function getHexNormalColorAndOpacityObject(color) {
    'use strict';
    var opacity = 1;
    if (color.indexOf('rgb') !== -1) {
        if (color.indexOf('rgba') !== -1) {
            opacity = color.replace(/^.*,(.+)\)/,'$1');
        }
        color = this.rgb2hex(color);
    }

    var hexColorAndOpacityObject = {};
    hexColorAndOpacityObject['color'] = color;
    hexColorAndOpacityObject['opacity'] = opacity;

    return hexColorAndOpacityObject;
};

/**
 * @param {string} orig
 * @returns {string}
 */
Mapbender.Model.prototype.rgb2hex = function rgb2hex(orig) {
    'use strict';
    var rgb = orig.replace(/\s/g,'').match(/^rgba?\((\d+),(\d+),(\d+)/i);
    return (rgb && rgb.length === 4) ? "#" +
        ("0" + parseInt(rgb[1],10).toString(16)).slice(-2) +
        ("0" + parseInt(rgb[2],10).toString(16)).slice(-2) +
        ("0" + parseInt(rgb[3],10).toString(16)).slice(-2) : orig;
};

/**
 *
 * @param elementConfig
 */
Mapbender.Model.prototype.createMousePositionControl = function createMousePositionControl(elementConfig){
    'use strict';
    var template = elementConfig.prefix + '{x}' + elementConfig.separator + '{y}';
    var mousePositionControl = new ol.control.MousePosition({
        coordinateFormat: function(coordinate) {

            return ol.coordinate.format(coordinate, template, elementConfig.numDigits);
        },
        projection: elementConfig.displayProjection.projCode,
        className: 'custom-mouse-position',
        target: elementConfig.target,
        undefinedHTML: elementConfig.emptyString
    });
    this.olMap.addControl(mousePositionControl);
};

/**
 * Get bounds from binary geometry of a particular format
 *
 * @param {string} binary
 * @param {string} format must be a string identifier of {ol.format} https://openlayers.org/en/latest/apidoc/ol.format.html
 * @returns {top, right, bottom, left} extent object
 */
Mapbender.Model.prototype.getBoundsFromBinaryUsingFormat = function (binary, format) {
    if (typeof ol.format[format] === 'undefined') {
        console.error("Format is not supported", format);
        throw new Error("Format" + format + " is not supported");
    }

    var formatObject = new ol.format[format]();
    var feature = formatObject.readFeature(binary);

    var extent = feature.getGeometry().getExtent();

    return this.mbExtent(extent);
};

/**
 * Get resolution for zoom level
 *
 * @param {number} zoom
 * @returns {number}
 */
Mapbender.Model.prototype.getResolutionForZoom = function (zoom) {
    return this.olMap.getView().getResolutionForZoom(zoom);
};

/**
 * Get zoom for resolution
 *
 * @param {number} resolution
 * @returns {number|undefined}
 */
Mapbender.Model.prototype.getZoomForResolution = function (resolution) {
    return this.olMap.getView().getZoomForResolution(resolution);
};


/**
 *
 * @param projection
 */
Mapbender.Model.prototype.mousePositionControlUpdateProjection = function mousePositionControlUpdateProjection(projection) {
    'use strict';
    this.olMap.getControls().forEach(function (control) {
        if (control instanceof ol.control.MousePosition) {
            control.setProjection(projection);
        }
    });
};

/**
 * @param {object} options
 * @returns {object}
 */
Mapbender.Model.prototype.initializeViewOptions = function initializeViewOptions(options) {
    'use strict';
    var proj = ol.proj.get(options.srs);
    var viewOptions = {
        projection: proj
    };
    if (options.maxExtent) {
        viewOptions.extent = options.maxExtent;
    }

    if (options.scales && options.scales.length) {
        // Sometimes, the units are empty -.-
        // this seems to happen predominantely with "degrees" SRSs, so...
        var units = ol.proj.get(options.srs).getUnits();
        viewOptions['resolutions'] = options.scales.map(function(scale) {
            return this.scaleToResolutionStatic(scale, options.dpi || 72, proj.getUnits() || "degrees");
        }.bind(this));
    } else {
        viewOptions.zoom = 7; // hope for the best
    }
    return viewOptions;
};

/**
 * Recalculate a resolution number valid for fromUnit to an equivalent valid
 * for toUnit.
 * This is technically sth like:
 *   newRes = scaleToRes(resToScale(oldScale, dpi, oldUnit), dpi, newUnit).
 * If you look at the resolutionToScale and scaleToResolution math,
 * you'll see that the result of the back-and-forth transformation ONLY
 * depends on the meters per unit, and on nothing else.
 *
 * This allows us to perform the calculation independent of dpi settings.
 *
 * @param {string} fromUnits "m", "degrees" etc
 * @param {string} toUnits "m", "degrees" etc
 * @param {number} resolution
 * @returns {number}
 * @private
 * @static
 */
Mapbender.Model.convertResolution_ = function convertResolution_(fromUnits, toUnits, resolution) {
    var resolutionFactor =
        ol.proj.METERS_PER_UNIT[fromUnits] /
        ol.proj.METERS_PER_UNIT[toUnits];
    return resolution * resolutionFactor;
};
// make available on instance
Mapbender.Model.prototype.convertResolution_ = Mapbender.Model.convertResolution_;

/**
 * Get resolution for extent
 *
 * @param {Array} extent [minx, miny, maxx, maxy]
 * @param {Array} size [width, height]
 * @returns {number}
 */
Mapbender.Model.prototype.getResolutionForExtent = function (extent, size) {
    return this.olMap.getView().getResolutionForExtent(extent, size);
};

/**
 * Create style for icon
 *
 * @param {*} options
 * @return {ol.style.Style}
 */
Mapbender.Model.prototype.createIconStyle = function (options) {
    var defaultOptions = {
        anchor: [0.5, 46],
        anchorXUnits: 'fraction',
        anchorYUnits: 'pixels',
    };

    var options_ = $.extend({}, options, defaultOptions);

    var iconStyle = new ol.style.Style({
        image: new ol.style.Icon(options_)
    });

    return iconStyle;
};

/**
 * Update the layer order of a source to the new sequence of layerIds.
 * Layers available in the source but not present in layerIds are skipped and remain exactly in their current
 * place.
 *
 * @param {string} sourceId
 * @param {string[]} layerIds
 */
Mapbender.Model.prototype.setSourceLayerOrder = function setSorceLayerOrder(sourceId, layerIds) {
    var source = this.getSourceById(sourceId);
    source.updateLayerOrderById(layerIds);
};

/**
 *
 * @param {string|object|SourceModelOl4} source
 * @param {boolean} visible
 */
Mapbender.Model.prototype.setSourceState = function setSourceState(source, visible) {
    var sourceObj = this.toSourceObj_(source);
    sourceObj.setState(visible);
};

/**
 * create ol.style.Style
 * @param {array} customStyle only fill, stroke, zIndex
 * @returns {ol.style.Style}
 */
Mapbender.Model.prototype.getCustomStyle = function getCustomStyle(customStyle) {
    'use strict';
    var geometry = undefined;
    var fill = undefined;
    var image = undefined;
    var renderer = undefined;
    var stroke = undefined;
    var text = undefined;
    var zIndex = undefined;
    var keys = Object.keys(customStyle);
    var options = null;

    if (keys.length){
        for (var i = 0; i < keys.length; i++) {
            var varName = keys[i];

            switch(varName) {
                case 'geometry':
                    options = customStyle[varName] || '';
                    fill = new ol.geom.Geometry(options);
                    break;
                case 'fill':
                    options = customStyle[varName] || {};
                    fill = new ol.style.Fill(options);
                    break;
                case 'image':
                    options = customStyle[varName] || {};
                    image = new ol.style.Image(options);
                    break;
                case 'renderer':
                    options = customStyle[varName] || {};
                    stroke = ol.StyleRenderFunction(options);
                    break;
                case 'stroke':
                    options = customStyle[varName] || {};
                    stroke = new ol.style.Stroke(options);
                    break;
                case 'text':
                    options = customStyle[varName] || {};
                    stroke = new ol.style.Text(options);
                    break;
                case 'zIndex':
                    zIndex = customStyle[varName] ? customStyle[varName] : undefined;
                    break;
            }

        }
    }

    return new ol.style.Style({
        geometry: geometry,
        fill: fill,
        image: image,
        renderer:renderer,
        stroke: stroke,
        text: text,
        zIndex: zIndex
    });
};

/**
 *
 * @param {string|number|object|SourceModelOl4} input
 * @returns {Mapbender.SourceModelOl4}
 * @private
 */
Mapbender.Model.prototype.toSourceObj_ = function toSourceObj_(input) {
    if (input instanceof Mapbender.SourceModelOl4) {
        return input;
    }
    switch (typeof input) {
        case 'string':
        case 'number':
            return this.getSourceById('' + input);
        case 'object':
            if (typeof input.id !== 'undefined') {
                return this.toSourceObj_(input.id);
            }
            break;
    }
    console.error("Could not identify requested source from input", input);
    throw new Error("Could not identify requested source");
};

Mapbender.Model.prototype.reorderSources = function reorderSources(sources) {
    var sourceObjs = sources.map(this.toSourceObj_.bind(this));
    var newIdOrder = sourceObjs.map(function(source) { return source.id; });
    // Collect currently set positions and z indexes for given sources.
    // position := array index in this.sourceTree
    // z index := mapquery layer position = openlayers map layer index - 1
    // The collected values will be reused / redistributed to the affected
    // sources.
    var oldPositions = [];
    var zIndexes = [];
    var sourceIdToSource = {};
    _.forEach(sourceObjs, function(sourceObj) {
        var currentPosition = this.pixelSources.indexOf(sourceObj);
        if (currentPosition === -1) {
            console.error("Could not find relative position of source", sourceObj, this.pixelSources);
            throw new Error("Could not find relative position of source");
        }
        oldPositions.push(currentPosition);
        sourceIdToSource[sourceObj.id] = sourceObj;
        zIndexes.push(sourceObj.getZIndex());
    }.bind(this));
    oldPositions.sort();
    zIndexes.sort();
    // rewrite pixelSources order and z indexes
    for (var i = 0; i < oldPositions.length; ++i) {
        var oldPos = oldPositions[i];
        var injectSourceId = newIdOrder[i];
        var injectSourceObj = sourceIdToSource[injectSourceId];
        var injectSourceZ = zIndexes[i];
        this.pixelSources[oldPos] = injectSourceObj;
        injectSourceObj.setZIndex(injectSourceZ);
    }
    this.olMap.render();
};

/**
 *
 * @param callback
 * @returns {ol.EventsKey|Array<ol.EventsKey>}
 */
Mapbender.Model.prototype.setOnChangeResolutionHandler = function (callback) {
    'use strict';

    if (typeof callback === 'function') {
        return this.olMap.on("change:resolution", callback);
    }
};

/**
 *
 * @param extent
 * @param size
 * @returns {number}
 */
Mapbender.Model.prototype.getResolutionForExtent = function getResolutionForExtent(extent, size){
    'use strict';

    var xResolution = ol.extent.getWidth(extent) / size[0];
    var yResolution = ol.extent.getHeight(extent) / size[1];

    return Math.max(xResolution, yResolution);
};

/**
 *
 * @param scale
 * @param units
 * @returns {number}
 */
Mapbender.Model.prototype.getResolutionForScale = function getResolutionForScale (scale, units) {
    var dpi = 25.4 / 0.28;
    var mpu = ol.proj.METERS_PER_UNIT[units];
    var inchesPerMeter = 39.37;
    return parseFloat(scale) / (mpu * inchesPerMeter * dpi);
};