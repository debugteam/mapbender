(function($) {

$.widget('mapbender.mbSimpleSearch', {
    options: {
        url: null,
        /** one of 'WKT', 'GeoJSON' */
        token_regex: null,
        token_regex_in: null,
        token_regex_out: null,
        label_attribute: null,
        geom_attribute: null,
        geom_format: null,
        result_buffer: null,
        result_minscale: null,
        result_maxscale: null,
        result_icon_url: null,
        result_icon_offset: null,
        sourceSrs: 'EPSG:4326',
        delay: 0
    },

    layer: null,
    mbMap: null,
    iconUrl_: null,

    _create: function() {
        this.iconUrl_ = this.options.result_icon_url || null;
        if (this.options.result_icon_url && !/^(\w+:)?\/\//.test(this.options.result_icon_url)) {
            // Local, asset-relative
            var parts = [
                Mapbender.configuration.application.urls.asset.replace(/\/$/, ''),
                this.options.result_icon_url.replace(/^\//, '')
            ];
            this.iconUrl_ = parts.join('/');
        }
        var self = this;
        Mapbender.elementRegistry.waitReady('.mb-element-map').then(function(mbMap) {
            self.mbMap = mbMap;
            self._setup();
        });
    },
    _setup: function() {
        var self = this;
        var searchInput = $('.searchterm', this.element);
        var url = Mapbender.configuration.application.urls.element + '/' + this.element.attr('id') + '/search';
        this.layer = Mapbender.vectorLayerPool.getElementLayer(this, 0);
        if (this.iconUrl_) {
            var offset = (this.options.result_icon_offset || '').split(new RegExp('[, ;]')).map(function(x) {
                return parseInt(x) || 0;
            });
            this.layer.addCustomIconMarkerStyle('simplesearch', this.iconUrl_, offset[0], offset[1]);
        }


        // Work around FOM Autocomplete widget broken constructor, where all instance end up sharing the
        // same options object
        // @todo: drop the FOM Autocomplete widget usage entirely (SimpleSearch is the only user)
        var acOptions = Object.assign({}, Mapbender.Autocomplete.prototype.options, {
                url: url,
                delay: this.options.delay,
                dataTitle: this.options.label_attribute,
                dataIdx: null,
                preProcessor: $.proxy(this._tokenize, this)
        });
        this.autocomplete = new Mapbender.Autocomplete(searchInput, {
            url: acOptions.url,
            delay: acOptions.delay
        });
        this.autocomplete.options = acOptions;

        // On manual submit (enter key, submit button), trigger autocomplete manually
        this.element.on('submit', function(evt) {
            var searchTerm = searchInput.val();
            if(searchTerm.length >= self.autocomplete.options.minLength) {
                self.autocomplete.find(searchTerm);
            }
            evt.preventDefault();
        });
        this.mbMap.element.on('mbmapsrschanged', function(event, data) {
            self.layer.retransform(data.from, data.to);
        });

        // On item selection in autocomplete, parse data and set map bbox
        searchInput.on('mbautocomplete.selected', $.proxy(this._onAutocompleteSelected, this));
    },
    _parseFeature: function(doc) {
        switch ((this.options.geom_format || '').toUpperCase()) {
            case 'WKT':
                return this.mbMap.getModel().parseWktFeature(doc, this.options.sourceSrs);
            case 'GEOJSON':
                return this.mbMap.getModel().parseGeoJsonFeature(doc, this.options.sourceSrs);
            default:
                throw new Error("Invalid geom_format " + this.options.geom_format);
        }
    },
    _onAutocompleteSelected: function(evt, evtData) {
        if(!evtData.data[this.options.geom_attribute]) {
            $.notify( Mapbender.trans("mb.core.simplesearch.error.geometry.missing"));
            return;
        }
        var feature = this._parseFeature(evtData.data[this.options.geom_attribute]);

        var zoomToFeatureOptions = {
            maxScale: parseInt(this.options.result_maxscale) || null,
            minScale: parseInt(this.options.result_minscale) || null,
            buffer: parseInt(this.options.result_buffer) || null
        };
        this.mbMap.getModel().zoomToFeature(feature, zoomToFeatureOptions);
        this._hideMobile();
        this._setFeatureMarker(feature);
    },
    _setFeatureMarker: function(feature) {
        this.layer.clear();
        Mapbender.vectorLayerPool.raiseElementLayers(this);
        var layer = this.layer;
        // @todo: add feature center / centroid api
        var bounds = Mapbender.mapEngine.getFeatureBounds(feature);
        var center = {
            lon: .5 * (bounds.left + bounds.right),
            lat: .5 * (bounds.top + bounds.bottom)
        };
        // fallback for broken icon: render a simple point geometry
        var onMissingIcon = function() {
            layer.addMarker(center.lon, center.lat);
        };
        if (this.iconUrl_) {
            layer.addIconMarker('simplesearch', center.lon, center.lat).then(null, onMissingIcon);
        } else {
            onMissingIcon();
        }
    },

    _hideMobile: function() {
        $('.mobileClose', $(this.element).closest('.mobilePane')).click();
    },

    _tokenize: function(string) {
        if (!(this.options.token_regex_in && this.options.token_regex_out)) return string;

        if (this.options.token_regex) {
            var regexp = new RegExp(this.options.token_regex, 'g');
            string = string.replace(regexp, " ");
        }

        var tokens = string.split(' ');
        var regex = new RegExp(this.options.token_regex_in);
        for(var i = 0; i < tokens.length; i++) {
            tokens[i] = tokens[i].replace(regex, this.options.token_regex_out);
        }

        return tokens.join(' ');
    }
});

})(jQuery);
