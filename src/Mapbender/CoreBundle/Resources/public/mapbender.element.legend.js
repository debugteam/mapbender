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

        /**
         * Widget constructor
         *
         * @private
         */
        _create: function() {
            this.htmlContainer = $('> .legends', this.element);
            var self = this;
            Mapbender.elementRegistry.waitReady(this.options.target).then(function(mbMap) {
                self._setup(mbMap);
            }, function() {
                Mapbender.checkTarget("mbLegend", self.options.target);
            });
        },

        /**
         * Setup widget
         *
         * @private
         */
        _setup: function(mbMap) {
            this.mbMap = mbMap;
            $(document).one('mbmapsourceloadend', $.proxy(this.onMapLoaded, this));
            this._trigger('ready');
        },

        /**
         * On map loaded
         *
         * @param e
         */
        onMapLoaded: function(e) {
            this.onMapLayerChanges();

            if (this.options.elementType === 'dialog') {
                if (this.options.autoOpen) {
                    this.open();
                }
            }

            $(document)
                .bind('mbmapsourceadded mbmapsourcechanged mbmapsourcemoved mbmapsourcesreordered', $.proxy(this.recognizeAnyChanges, this));

            $(document).bind('mbmapzoomchanged moveend', $.proxy(this.onMapLayerChanges, this));
        },

        changesRecognized: false,

        recognizeAnyChanges: function(e){
            if(!this.changesRecognized && !this.popupWindow) {
                this.changesRecognized = true;
            }

            this.onMapLayerChanges(e);
        },

        /**
         * On map layer changes handler
         *
         * @param e
         */
        onMapLayerChanges: function(e){
        console.log("On MapLayerChange");
        console.log(e);
            this.render();

            if (this.popupWindow) {
                this.popupWindow.open(this.element);
            }
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

                if (this.options.dynamicLegends){
                    legendUrl = this._appendDynamicLegendUrlParameter(legendUrl, this._prepareDynamicLegendParameter());
                }

                return legendUrl || null;
            }
            return null;
        },

        _prepareDynamicLegendParameter: function(){
            var model = this.mbMap.getModel();
            var olMap = model.olMap;

            return {
                'SRS': model.getCurrentProjectionCode(),
                'CRS': model.getCurrentProjectionCode(),
                'BBOX': olMap.getExtent().toBBOX(),
                'WIDHT': olMap.getSize()['w'],
                'HEIGHT': olMap.getSize()['h']
            };
        },

        _appendDynamicLegendUrlParameter: function(legendUrl, params){
            _.each(params, function(key, value){
                legendUrl = legendUrl + "&" + key + "=" + value;
            });

            return legendUrl;
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

        /**
         * Render HTML
         *
         * @return strgin HTML jQuery object
         */
        render: function() {
            var widget = this;
            var sources = widget._getSources();

            widget.htmlContainer.empty();
            widget.imagesInitialized = false;
            _.each(sources, function(source){
                var html = widget._createList()
                    .addClass('legend-source');

                html.append(widget._createListElement().append(widget._createLabel(source.title, 'legend-title')));
                html.append(widget._createLegendNode(source));

                widget.htmlContainer.append(html);
            });
        },

        _createLegendNode: function(source){
            var widget = this;

            var nodeHtml = widget._createListElement();

            _.each(source.children, function(childSource){
                var nodeHtmlListElement = widget._createList();
                nodeHtmlListElement.attr('legend-parent', source.id);

                if(!childSource.legend && childSource.children.length > 0){
                    nodeHtmlListElement.addClass('legend-node');
                    nodeHtmlListElement.append(widget._createListElement().append(widget._createLabel(childSource.title, 'legend-nodeTitle')));

                    nodeHtmlListElement.append(widget._createLegendNode(childSource));
                }else if(childSource.legend){
                    nodeHtmlListElement.addClass('legend-layer');
                    nodeHtmlListElement.append(widget._createListElement().append(widget._createLabel(childSource.title, 'legend-layerTitle')));

                    nodeHtmlListElement.append(widget._createListElement().append(widget._createImage(childSource.legend)));

                    var layerSeparator = widget._createSeparator();
                    nodeHtmlListElement.append(layerSeparator);
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

        _initializeImageCounter: function(){
            this.imagesTotal = $('.legends').find('img').length;
            this.imagesLoaded = 0;

            this.imagesInitialized = true;
        },

        _allImagesLoaded: function(){
            var widget = this;
            var classesToRemove = ['.legend-source', '.legend-node', '.legend-layer'];

            _.each(classesToRemove, function(classesToRemove){
                widget._removeImages(classesToRemove);
            });
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
            return $('<img/>')
                .attr('src', src)
                .attr('onload', function(){
                    var image = $(this);
                    $(this).load(function() {
                        if(!widget.imagesInitialized){
                            widget._initializeImageCounter();
                        }

                        if($(image).height() <= 2){
                            $(image).remove();
                        }

                        widget.imagesLoaded++;

                        if(widget.imagesLoaded === widget.imagesTotal){
                            widget._allImagesLoaded();
                        }
                    });
                });
        },

        _createSeparator: function(){
            return $('<span/>').addClass('legend-separator');
        },

        /**
         *   var layerData = {
                id:       layer.options.id,
                title:    layer.options.title,
                level:    level,
                legend: this.getLegendUrl(layer),
                children: []
            };
         */
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
                    }
                ]
            };
        }
    });

})(jQuery);
