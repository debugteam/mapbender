(function($){
    'use strict';

    /**
     * @typedef {{type:string, opacity:number, geometries: Array<Object>}} VectorLayerData~export
     * @typedef {{type:string, opacity:number, markers: Array<Object>}} MarkerLayerData~export
     */
    $.widget("mapbender.mbImageExport", {
        options: {},
        map: null,
        $form: null,

        _create: function(){
            if(!Mapbender.checkTarget(this.widgetName, this.options.target)){
                return;
            }
            this.$form = $('form', this.element);
            $(this.element).show();
            Mapbender.elementRegistry.onElementReady(this.options.target, $.proxy(this._setup, this));
        },
        _setup: function() {
            this.map = $('#' + this.options.target).data('mapbenderMbMap');
            this.$form.on('submit', this._onSubmit.bind(this));
            this._trigger('ready');
        },
        defaultAction: function(callback){
            this.open(callback);
        },
        open: function(callback){
            this.callback = callback ? callback : null;
            var self = this;
            if(!this.popup || !this.popup.$element){
                this.popup = new Mapbender.Popup({
                    title: self.element.attr('title'),
                    draggable: true,
                    header: true,
                    modal: false,
                    closeOnESC: false,
                    content: self.element,
                    width: 250,
                    scrollable: false
                });
                this.popup.$element.one('close', $.proxy(this.close, this));
            }
        },
        close: function(){
            if (this.popup) {
                this.popup.close();
                this.popup = null;
            }
            if (this.callback) {
                (this.callback)();
                this.callback = null;
            }
        },
        /**
         * @returns {Array<Object>} sourceTreeish configuration objects
         * @private
         */
        _getRasterSourceDefs: function() {
            return this.map.getSourceTree();
        },
        _getExportScale: function() {
            return null;
        },
        _getExportExtent: function() {
            var lbrt = this.map.model.getCurrentExtentArray();
            return {
                left: lbrt[0],
                bottom: lbrt[1],
                right: lbrt[2],
                top: lbrt[3]
            };
        },
        _collectRasterLayerData: function() {
            var sources = this._getRasterSourceDefs();
            var scale = this._getExportScale();
            var extent = this._getExportExtent();

            var dataOut = [];

            for (var i = 0; i < sources.length; i++) {
                var sourceDef = sources[i];
                dataOut.push.apply(dataOut, this.map.model.getPrintConfigEx(sourceDef, scale, extent));
            }
            return dataOut;
        },
        _collectJobData: function() {
            var mapExtent = this._getExportExtent();
            var imageSize = this.map.model.getCurrentViewportSize();
            var rasterLayers = this._collectRasterLayerData();
            var geometryLayers;
            switch (Mapbender.mapEngine.code) {
                case 'ol2':
                    geometryLayers = this._collectGeometryAndMarkerLayers();
                    break;
                case 'ol4':
                    geometryLayers = this._collectGeometryLayers4();
                    break;
                default:
                    throw new Error("Unsupported map engine " + Mapbender.mapEngine.code);
            }
            return {
                layers: rasterLayers.concat(geometryLayers),
                width: imageSize.width,
                height: imageSize.height,
                center: {
                    x: Math.min(mapExtent.left, mapExtent.right) + 0.5 * Math.abs(mapExtent.right - mapExtent.left),
                    y: Math.min(mapExtent.bottom, mapExtent.top) + 0.5 * Math.abs(mapExtent.top - mapExtent.bottom)
                },
                extent: {
                    width: Math.abs(mapExtent.right - mapExtent.left),
                    height: Math.abs(mapExtent.top - mapExtent.bottom)
                }
            };
        },
        _onSubmit: function(evt) {
            // add job data to hidden form fields
            var jobData = this._collectJobData();
            if (!jobData.layers.length) {
                Mapbender.info(Mapbender.trans("mb.print.imageexport.info.noactivelayer"));
                return false;
            }
            this._injectJobData(jobData);
            return true;    // let the browser do the rest
        },
        _injectJobData: function(jobData) {
            var $hiddenArea = $('.-fn-hidden-fields', this.$form);
            $hiddenArea.empty();
            var submitValue = JSON.stringify(jobData);
            var $input = $('<input/>').attr('type', 'hidden').attr('name', 'data');
            $input.val(submitValue);
            $input.appendTo($hiddenArea);
        },
        /**
         * Injects data AND submits form
         * @param {Object} jobData
         * @private
         * @deprecated distinctly use _injectJobData and regular form submit events
         */
        _submitJob: function(jobData) {
            this._injectJobData(jobData);
            $('input[type="submit"]', this.$form).click();
        },
        /**
         * Should return true if the given layer needs to be included in export
         *
         * @param {OpenLayers.Layer.Vector|OpenLayers.Layer} layer
         * @returns {boolean}
         * @private
         */
        _filterGeometryLayer: function(layer) {
            if ('OpenLayers.Layer.Vector' !== layer.CLASS_NAME || layer.visibility === false || this.layer === layer) {
                return false;
            }
            if (!(layer.features && layer.features.length)) {
                return false;
            }
            return true;
        },
        /**
         * Should return true if the given layer needs to be included in export
         *
         * @param {OpenLayers.Layer.Markers|OpenLayers.Layer} layer
         * @returns {boolean}
         * @private
         */
        _filterMarkerLayer: function(layer) {
            if ('OpenLayers.Layer.Markers' !== layer.CLASS_NAME || layer.visibility === false || this.layer === layer) {
                return false;
            }
            if (!(layer.markers && layer.markers.length)) {
                return false;
            }
            return layer.opacity > 0;
        },
        /**
         * Should return true if the given feature should be included in export.
         *
         * @param {OpenLayers.Feature.Vector} feature
         * @returns {boolean}
         * @private
         */
        _filterFeature: function(feature) {
            // onScreen throws an error if geometry is not populated, see
            // https://github.com/openlayers/ol2/blob/release-2.13.1/lib/OpenLayers/Feature/Vector.js#L198
            if (!feature.geometry || !feature.onScreen(true)) {
                return false;
            }
            return true;
        },
        /**
         * Extracts and preprocesses the geometry from a feature for export backend consumption.
         *
         * @param {OpenLayers.Layer.Vector|OpenLayers.Layer} layer
         * @param {OpenLayers.Feature.Vector} feature
         * @returns {Object} geojsonish, with (non-conformant) "style" entry bolted on (native Openlayers format!)
         * @private
         */
        _extractFeatureGeometry: function(layer, feature) {
            var geometry = this._geometryToGeoJson(feature.geometry);
            if (feature.style) {
                // stringify => decode: makes a deep copy of the style at the moment of capture
                geometry.style = JSON.parse(JSON.stringify(feature.style));
            } else {
                geometry.style = layer.styleMap.createSymbolizer(feature, feature.renderIntent);
            }
            if (geometry.style && geometry.style.externalGraphic) {
                geometry.style.externalGraphic = this._fixAssetPath(geometry.style.externalGraphic);
            }
            return geometry;
        },
        /**
         * Should return true if the given feature geometry should be included in export.
         *
         * @param geometry
         * @returns {boolean}
         * @private
         */
        _filterFeatureGeometry: function(geometry) {
            if (geometry.style.fillOpacity > 0 || geometry.style.strokeOpacity > 0) {
                return true;
            }
            if (geometry.style.externalGraphic) {
                return true;
            }
            if (geometry.style.label !== undefined) {
                return true;
            }
            return false;
        },
        /**
         * Should return export data (sent to backend) for the given geometry layer. Given layer is guaranteed
         * to have passsed through the _filterGeometryLayer check positively.
         *
         * @param {OpenLayers.Layer.Vector|OpenLayers.Layer} layer
         * @returns VectorLayerData~export
         * @private
         */
        _extractGeometryLayerData: function(layer) {
            var geometries = layer.features
                .filter(this._filterFeature.bind(this))
                .map(this._extractFeatureGeometry.bind(this, layer))
                .filter(this._filterFeatureGeometry.bind(this))
            ;
            return {
                type: 'GeoJSON+Style',
                opacity: 1,
                geometries: geometries
            };
        },
        _collectGeometryLayers4: function() {
            var layersFlat = [];
            this.map.model.olMap.getLayers().getArray().forEach(function (olLayer) {
                olLayer.getLayersArray(layersFlat);
            });
            var vectorLayers = layersFlat.filter(function (olLayer) {
                return (olLayer instanceof ol.layer.Vector) && olLayer.getVisible();
            });
            var dataOut = [];
            for (var li = 0; li < vectorLayers.length; ++li) {
                var layer = vectorLayers[li];
                var features = layer.getSource().getFeatures();
                var layerFeatureData = [];
                for (var fi = 0; fi < features.length; ++fi) {
                    var feature = features[fi];
                    // @todo: no private access
                    var formattedFeature = Mapbender.Model._geojsonFormat.writeFeatureObject(feature).geometry;
                    formattedFeature.style = this.map.model.extractSvgFeatureStyle(layer, feature);
                    layerFeatureData.push(formattedFeature);
                }
                dataOut.push({
                    "type": "GeoJSON+Style",
                    "opacity": layer.getOpacity(),
                    "geometries": layerFeatureData
                });
            }
            return dataOut;
        },
        /**
         * Should return export data (sent to backend) for the given geometry layer. Given layer is guaranteed
         * to have passsed through the _filterGeometryLayer check positively.
         *
         * @param {OpenLayers.Layer.Markers|OpenLayers.Layer} layer
         * @returns MarkerLayerData~export
         * @private
         */
        _extractMarkerLayerData: function(layer) {
            var markerData = [];
            for (var i = 0; i < layer.markers.length; ++i) {
                var marker = layer.markers[i];
                var originalUrl = marker.icon && marker.icon.url;
                var internalUrl = this._fixAssetPath(originalUrl);
                if (!internalUrl) {
                    continue;
                }
                markerData.push({
                    coordinates: {
                        x: marker.lonlat.lon,
                        y: marker.lonlat.lat
                    },
                    width: marker.icon.size.w,
                    height: marker.icon.size.h,
                    offset: {
                        x: marker.icon.offset.x,
                        y: marker.icon.offset.y
                    },
                    path: internalUrl
                });
            }
            return {
                type: 'markers',
                opacity: layer.opacity,
                markers: markerData
            };
        },
        _collectGeometryAndMarkerLayers: function() {
            // Iterating over all vector layers, not only the ones known to MapQuery
            var allOlLayers = this.map.map.olMap.layers;
            var layerDataOut = [];
            for (var i = 0; i < allOlLayers.length; ++i) {
                var olLayer = allOlLayers[i];
                if (this._filterGeometryLayer(olLayer)) {
                    layerDataOut.push(this._extractGeometryLayerData(olLayer));
                } else if (this._filterMarkerLayer(olLayer)) {
                    layerDataOut.push(this._extractMarkerLayerData(olLayer));
                }
            }
            return layerDataOut;
        },
        /**
         * Convert potentially absolute URL to web-local url pointing somewhere into bundles/
         * @param {String} url
         * @returns {String|boolean}
         * @private
         */
        _fixAssetPath: function(url) {
            var urlOut = url.replace(/^.*?(\/)(bundles\/.*)/, '$2');
            if (urlOut === url) {
                console.warn("Asset path could not be resolved to local bundles reference", url);
                return false;
            } else {
                return urlOut;
            }
        },
        _noDanglingCommaDummy: null
    });

})(jQuery);
