(function($) {

$.widget('mapbender.mbMapBox', $.mapbender.mbButton, {
    options: {
        target: undefined,
        icon: undefined,
        label: true,
        group: undefined
    },

    map: null,
    boxControl: null,

    _create: function() {
        var self = this;
        var boxProxy = $.proxy(this._mapBoxHandler, this);

        this._super('_create');
        this.map = $('#' + this.options.target);

        this.boxControl = new OpenLayers.Control();
        OpenLayers.Util.extend(this.boxControl, {
            draw: function() {
                this.handler = new OpenLayers.Handler.Box(self.boxControl, {
                    done: boxProxy
                });
            }
        });
    },

    /**
     * On activation, bind the onClick function to handle map click events.
     * For the call to be made in the right context, the onClickProxy must
     * be used.
     */
    activate: function() {
        this._super('activate');
        if(this.map.length !== 0) {
            this.map.data('mbMap').map.olMap.addControl(this.boxControl);
            this.boxControl.activate();
        }
    },

    /**
     * On deactivation, unbind the onClick handler
     */
    deactivate: function() {
        this._super('deactivate');
        if(this.map.length !== 0) {
            this.boxControl.deactivate();
            this.map.data('mbMap').map.olMap.removeControl(this.boxControl);
        }
    },

    /**
     * The actual box event handler. Here Pixel and World coordinates
     * are extracted and then send to the mapBoxWorker
     */
    _mapBoxHandler: function(boundsOrPixel) {
        var extent = null;
        if(boundsOrPixel.CLASS_NAME === 'OpenLayers.Pixel') {
            extent = {
                pixel: {
                    xmin: boundsOrPixel.x,
                    ymin: boundsOrPixel.y,
                    xmax: boundsOrPixel.x,
                    ymax: boundsOrPixel.y
                }
            }
        } else {
            extent = {
                pixel: {
                    xmin: boundsOrPixel.left,
                    ymin: boundsOrPixel.bottom,
                    xmax: boundsOrPixel.right,
                    ymax: boundsOrPixel.top
                }
            }
        }

        var ll = this.map.data('mbMap').map.olMap.
            getLonLatFromPixel(new OpenLayers.Pixel(
                extent.pixel.xmin,
                extent.pixel.ymin));
        var ur = this.map.data('mbMap').map.olMap.
            getLonLatFromPixel(new OpenLayers.Pixel(
                extent.pixel.xmax,
                extent.pixel.ymax));

        extent.world = {
            xmin: ll.lon,
            ymin: ll.lat,
            xmax: ur.lon,
            ymax: ur.lat
        };

        this._mapBoxWorker(extent);
    },

    /**
     * This should be used for your own logic. This function receives an
     * coordinates object which has two properties 'pixel' and 'world' which
     * hold the pixel and world coordinates of the drawn box extent. Each 
     * property has xmin, ymin, xmax and ymax values.
     */
    _mapBoxWorker: function(extent) {
        alert('You clicked: [' + 
                extent.pixel.xmin + ',' + extent.pixel.ymin +
                ' x ' +
                extent.pixel.xmax + ',' + extent.pixel.ymax +
                '] (Pixels), which equals [' +
                extent.world.xmin + ',' + extent.world.ymin +
                ' x ' +
                extent.world.xmax + ',' + extent.world.ymax +
                '] (World).');
    }
});

})(jQuery);

