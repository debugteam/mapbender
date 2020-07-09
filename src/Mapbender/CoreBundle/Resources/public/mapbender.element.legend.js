(function($) {

    $.widget("mapbender.mbLegend", {
        options: {
            autoOpen:                 true,
            target:                   null,
            elementType:              "dialog",
            displayType:              "list",
            showSourceTitle:          true,
            showLayerTitle:           true,
            showGroupedLayerTitle: true,
            dynamicLegends: false
        },

        callback:       null,
        mbMap: null,
        olMap: null,
        dynamicLegendsMapping: null,

        /**
         * Widget constructor
         *
         * @private
         */
        _create: function() {
            var widget = this;

            widget.htmlContainer = $('> .legends', widget.element);
            Mapbender.elementRegistry.waitReady(this.options.target).then(function(mbMap) {
                widget._setup(mbMap);
            }, function() {
                Mapbender.checkTarget("mbLegend", widget.options.target);
            });
        },

        /**
         * Setup widget
         *
         * @private
         */
        _setup: function(mbMap) {
            this.mbMap = mbMap;
            this.olMap = this.mbMap.getModel().olMap;

            this.dynamicLegendsMapping = this.mbMap.options['dynamic-legends']['mapping'];

            this._initLoadScreen();

            $(document).one('mbmapsourceloadend', $.proxy(this.onMapLoaded, this));
            this._trigger('ready');
        },

        _initLoadScreen: function(){
            this.loaderContainer = $('<div/>')
                .addClass('legends-loader-container');

            var loader = $('<div/>')
                .addClass('legends-loader');
            this.loaderContainer.append(loader);
            this.element.append(this.loaderContainer);
        },

        /**
         * On map loaded
         *
         * @param e
         */
        onMapLoaded: function(e) {
            this.recognizeAnyChanges();

            if (this.options.elementType === 'dialog') {
                if (this.options.autoOpen) {
                    this.open();
                }
            }

            $(document)
                .bind('mbmapsourceadded mbmapsourcechanged mbmapsourcemoved mbmapsourcesreordered', $.proxy(this.onMapLayerChanges, this));

            if (this.options.dynamicLegends) {
                $(document).bind('mbmapzoomchanged', $.proxy(this.recognizeAnyChanges, this));
                this.olMap.events.register('moveend', this, $.proxy(this.recognizeAnyChanges, this));
            }
        },

        changesRecognized: false,

        recognizeAnyChanges: function(e){
            this.changesRecognized = true;
        },

        /**
         * On map layer changes handler
         *
         * @param e
         */
        onMapLayerChanges: function(e){
            this.changesRecognized = false;
            this.render();
        },

        /**
         *
         * @return {Array}
         * @private
         */
        _getSources: function() {
            var sourceDataList = [];
            var sources = this.mbMap.getModel().getSources();
            for (var i = 0; i < sources.length; ++i) {
                var rootLayer = sources[i].configuration.children[0];
                if (rootLayer.state.visibility) {
                    // display in reverse map order
                    sourceDataList.unshift(this._getLayerData(sources[i], rootLayer, 1));
                }
            }
            return sourceDataList;
        },
        /**
         * Get legend
         *
         * @param layer
         * @return {*}
         */
        getLegendUrl: function(layer) {
            if (layer.options.legend) {
                var legendUrl = layer.options.legend.url;

                if(legendUrl && legendUrl.includes("/mapproxy/")){
                    legendUrl = this._rewriteHostUrl(legendUrl);
                }

                if (this.options.dynamicLegends){
                    legendUrl = this._appendDynamicLegendUrlParameter(legendUrl, this._prepareDynamicLegendParameter());
                }

                return legendUrl || null;
            }
            return null;
        },

        _rewriteHostUrl: function(url){
            var parts = this._parseURL(url);

            // Dienst ermitteln
            var mapproxyService = parts.pathname.split('/')[2];
            var mappedLayer = this.dynamicLegendsMapping[mapproxyService][parts['searchObject']['layer']] || undefined;
            if(!mappedLayer){
                return url;
            }
            parts['pathname'] = mappedLayer.url;
            parts['searchObject']['layer'] = mappedLayer.layerName;

            return this._buildURL(parts);
        },

        _parseURL: function(url) {
            var parsedUrl = new URL(url);

            var searchObject = {},
                queries, split, i;
            // Let the browser do the work
            queries = decodeURIComponent(parsedUrl.search.replace(/^\?/, '')).split('&');
            for( i = 0; i < queries.length; i++ ) {
                split = queries[i].split('=');
                searchObject[split[0]] = split[1];
            }

            return {
                protocol: parsedUrl.protocol,
                host: parsedUrl.host,
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                pathname: parsedUrl.pathname,
                search: parsedUrl.search,
                searchObject: searchObject,
                hash: parsedUrl.hash
            };
        },

        _buildURL: function(parts){
            var url = parts['protocol'] + '//' + parts['host'] + parts['pathname'];

            return this._appendDynamicLegendUrlParameter(url, parts['searchObject']);
        },

        _prepareDynamicLegendParameter: function(){
            var model = this.mbMap.getModel();

            return {
                'SRS': model.getCurrentProjectionCode(),
                'CRS': model.getCurrentProjectionCode(),
                'BBOX': this.olMap.getExtent().toBBOX(),
                'WIDTH': this.olMap.getSize()['w'],
                'HEIGHT': this.olMap.getSize()['h']
            };
        },

        _appendDynamicLegendUrlParameter: function(legendUrl, params){
            var url  = new URL(legendUrl);

            $.each(params, function(key, value){
                url.searchParams.append(key, value);
            });

            return url.href;
        },

        /**
         *
         * @param source
         * @param layer
         * @param level
         * @return {*}
         * @private
         */
        _getLayerData: function(source, layer, level) {
            var layerData = {
                id:       layer.options.id,
                title:    layer.options.title,
                level:    level,
                legend: this.getLegendUrl(layer),
                children: []
            };

            if (layer.children && layer.children.length) {
                for (var i = 0; i < layer.children.length; ++i) {
                    var childLayer = layer.children[i];
                    if (!childLayer.state.visibility) {
                        continue;
                    }
                    var childLayerData = this._getLayerData(source, childLayer, level + 1);
                    if (childLayerData.legend || childLayerData.children.length) {
                        // display in reverse map order
                        layerData.children.unshift(childLayerData);
                    }
                }
            }

            return layerData;
        },

        /**
         * Default action for mapbender element
         */
        defaultAction: function(callback) {
            this.open(callback);
        },

        render: function() {
            // debounce
            if (this._applyTimeout) {
                clearTimeout(this._applyTimeout);
            }
            this._applyTimeout = window.setTimeout(this._renderReal.bind(this), 80);
        },

        /**
         * Render HTML
         *
         * @return strgin HTML jQuery object
         */
        _renderReal: function() {
            var widget = this;
            var sources = widget._getSources();

            widget.htmlContainer.hide();
            widget.loaderContainer.show();
            widget.htmlContainer.empty();
            widget.imagesInitialized = false;
            widget._resetImageCounter();
            _.each(sources, function(source){
                var html = widget._createList()
                    .addClass('legend-source');

                if(widget.options.showSourceTitle) {
                    html.append(widget._createListElement().append(widget._createLabel(source.title, 'legend-title')));
                }
                html.append(widget._createLegendNode(source));

                var layerSeparator = widget._createSeparator();
                html.append(layerSeparator);

                widget.htmlContainer.append(html);
            });

            if(widget.imagesTotal <= 0 || sources.length === 0){
                widget._allImagesLoaded();
            }
        },

        _createPlaceholder: function(){
            var widget = this;
            var placeholder = widget._createList()
                .addClass('legend-source');

            placeholder.append(widget._createListElement().append(widget._createLabel(Mapbender.trans('mb.core.legend.nolegend'), 'legend-nothing')));

            return placeholder;
        },

        _createLegendNode: function(source){
            var widget = this;

            var nodeHtml = widget._createListElement();

            _.each(source.children, function(childSource){
                var nodeHtmlListElement = widget._createList();
                nodeHtmlListElement.attr('legend-parent', source.id);

                if(!childSource.legend && childSource.children.length > 0){
                    nodeHtmlListElement.addClass('legend-node');
                    var nodeLabel;
                    if(widget.options.showGroupedLayerTitle) {
                        nodeLabel = widget._createLabel(childSource.title, 'legend-nodeTitle');
                        nodeLabel.addClass('legend-layerTitle');
                        nodeHtmlListElement.append(widget._createListElement().append(nodeLabel));
                    }

                    nodeHtmlListElement.append(widget._createLegendNode(childSource));
                }else if(childSource.legend){
                    nodeHtmlListElement.addClass('legend-layer');
                    if(widget.options.showLayerTitle) {
                        nodeHtmlListElement.append(widget._createListElement().append(widget._createLabel(childSource.title, 'legend-layerTitle')));
                    }

                    nodeHtmlListElement.append(widget._createListElement().append(widget._createImage(childSource.legend)));
                }
                nodeHtml.append(nodeHtmlListElement);
            });

            return nodeHtml;
        },

        _createList: function(){
            return $('<ul/>');
        },

        _createListElement: function(){
            return $('<li/>');
        },

        _createLabel: function(content, cssClass){
            return $('<label/>')
                .addClass(cssClass)
                .append(content);
        },

        imagesInitialized: false,
        imagesTotal: 0,
        imagesLoaded: 0,

        _resetImageCounter: function(){
            this.imagesTotal = 0;
            this.imagesLoaded = 0;

            this.imagesInitialized = true;
        },

        _allImagesLoaded: function(){
            var widget = this;
            var classesToRemove = ['.legend-source', '.legend-node', '.legend-layer'];


            _.each(classesToRemove, function(classesToRemove){
                widget._removeImages(classesToRemove);
            });

            if($('.legend-source').size() <= 0){
                widget.htmlContainer.append(widget._createPlaceholder());
            }

            widget.loaderContainer.hide();
            widget.htmlContainer.show();
        },

        _removeImages: function(classToSearchForImages){
            _.each($(classToSearchForImages), function(source){
                if($(source).find('img').length <= 0){
                    $(source).remove();
                }
            });
        },

        _createImage: function(src){
            var widget = this;
            widget.imagesTotal++;

            var image = new Image();
            image.onload = function(){
                if(this.naturalHeight <= 2){
                    $(this).remove();
                }

                widget.imagesLoaded++;

                if(widget.imagesLoaded === widget.imagesTotal){
                    widget._allImagesLoaded();
                }
            };
            image.onerror = function(){
                $(this).remove();

                widget.imagesLoaded++;

                if(widget.imagesLoaded === widget.imagesTotal){
                    widget._allImagesLoaded();
                }
            };
            image.src = src;

            return image;
        },

        _createSeparator: function(){
            return $('<span/>').addClass('legend-separator');
        },

        /**
         * On open handler
         */
        open: function(callback) {
            this.callback = callback;

            if (this.options.elementType === 'dialog') {
                if (!this.popupWindow) {
                    this.popupWindow = new Mapbender.Popup2(this.getPopupOptions());
                    this.popupWindow.$element.on('close', $.proxy(this.close, this));
                } else {
                    this.popupWindow.open();
                }

                if(this.changesRecognized){
                    this.onMapLayerChanges();
                }
            }
        },

        /**
         * On close
         */
        close: function() {
            if (this.popupWindow) {
                this.popupWindow.destroy();
                this.popupWindow = null;
            }
            if (this.callback) {
                this.callback.call();
                this.callback = null;
            }
        },
        getPopupOptions: function() {
            var self = this;
            return {
                title: this.element.attr('title'),
                draggable: true,
                resizable: true,
                modal: false,
                closeOnESC: false,
                detachOnClose: true,
                content: [this.element],
                width: 350,
                height: 500,
                buttons: [
                    {
                        label:    Mapbender.trans('mb.core.legend.popup.btn.ok'),
                        cssClass: 'button right',
                        callback: function() {
                            self.close();
                        }
                    },
                    {
                        label:    Mapbender.trans('mb.core.legend.popup.btn.refresh'),
                        cssClass: 'button left',
                        callback: function() {
                            self.onMapLayerChanges();
                        }
                    }
                ]
            };
        }
    });

})(jQuery);
