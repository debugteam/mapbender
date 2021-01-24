(function ($) {
    $.widget("mapbender.mbDimensionsHandler", {
        options: {
            dimensionsets: {}
        },
        model: null,
        _create: function () {
            var self = this;
            Mapbender.elementRegistry.waitReady(this.options.target).then(function(mbMap) {
                self._setup(mbMap);
            }, function() {
                Mapbender.checkTarget("mbDimensionsHandler", self.options.target);
            });
        },
        _setup: function (mbMap) {
            this.model = mbMap.getModel();
            var dimensionUuids = Object.keys(this.options.dimensionsets);
            for (var i = 0; i < dimensionUuids.length; ++i) {
                var key = dimensionUuids[i];
                var groupConfig = this.options.dimensionsets[dimensionUuids[i]];
                var targetDimensions = (groupConfig.group || []).map(function(compoundId) {
                    return {
                        sourceId: compoundId.replace(/-.*$/, ''),
                        dimensionName: compoundId.replace(/^.*-(\w+)-\w*$/, '$1')
                    };
                });
                this._preconfigureSources(targetDimensions, groupConfig.dimension.extent);
                this._setupGroup(key, targetDimensions);
            }
            this._trigger('ready');
        },
        _setupGroup: function(key, targetDimensions) {
            var self = this;
            var dimension;
            for (var i = 0; i < targetDimensions.length; ++i) {
                var targetDimension = targetDimensions[i];
                var source = this.model.getSourceById(targetDimension.sourceId);
                var sourceDimensionConfig = source && this._getSourceDimensionConfig(source, targetDimension.dimensionName);
                if (sourceDimensionConfig) {
                    dimension = Mapbender.Dimension(sourceDimensionConfig);
                    break;
                }
            }
            var valarea = $('#' + key + ' .dimensionset-value', this.element);
            valarea.text(dimension.getDefault());
            $('#' + key + ' .mb-slider', this.element).slider({
                min: 0,
                max: dimension.getStepsNum(),
                value: dimension.getStep(dimension.getDefault()),
                slide: function (event, ui) {
                    valarea.text(dimension.valueFromStep(ui.value));
                },
                stop: function (event, ui) {
                    for (var i = 0; i < targetDimensions.length; ++i) {
                        var source = self.model.getSourceById(targetDimensions[i].sourceId);
                        if (source) {
                            var params = {};
                            params[dimension.getOptions().__name] = dimension.valueFromStep(ui.value);
                            source.addParams(params);
                        }
                    }
                }
            });
        },
        _getSourceDimensionConfig: function(source, name) {
            var sourceDimensions = source && source.configuration.options.dimensions || [];
            for (var j = 0; j < sourceDimensions.length; ++j) {
                var sourceDimension = sourceDimensions[j];
                if (sourceDimension.name === name) {
                    return sourceDimension;
                }
            }
            return false;
        },
        _preconfigureSources: function(targetDimensions, extent) {
            for (var i = 0; i < targetDimensions.length; ++i) {
                var targetDimension = targetDimensions[i];
                var source = this.model.getSourceById(targetDimension.sourceId);
                this._preconfigureSource(source, targetDimension.dimensionName, extent);
            }
        },
        _preconfigureSource: function(source, dimensionName, extent) {
            var targetConfig = this._getSourceDimensionConfig(source, dimensionName);
            if (targetConfig) {
                targetConfig.extent = extent;
                var dimension = Mapbender.Dimension(targetConfig);
                // Apply (newly restrained by modified range) default param value to source
                var params = {};
                params[targetConfig.__name] = dimension.getDefault();
                try {
                    source.addParams(params);
                } catch (e) {
                    // Source is not yet an object, but we made our config changes => error is safe to ignore
                }
            }
        },
        _destroy: $.noop
    });
})(jQuery);
