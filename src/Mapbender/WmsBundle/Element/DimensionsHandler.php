<?php

namespace Mapbender\WmsBundle\Element;

use Mapbender\CoreBundle\Component\Element;
use Mapbender\WmsBundle\Component\DimensionInst;

/**
 * Dimensions handler
 * @author Paul Schmidt
 */
class DimensionsHandler extends Element
{

    /**
     * @inheritdoc
     */
    public static function getClassTitle()
    {
        return "mb.wms.dimhandler.class.title";
    }

    /**
     * @inheritdoc
     */
    public static function getClassDescription()
    {
        return "mb.wms.dimhandler.class.description";
    }

    /**
     * @inheritdoc
     */
    public static function getDefaultConfiguration()
    {
        return array(
            "tooltip" => "",
            "target" => null,
            'dimensionsets' => array()
            
        );
    }

    /**
     * @inheritdoc
     */
    public function getWidgetName()
    {
        return 'mapbender.mbDimensionsHandler';
    }

    /**
     * @inheritdoc
     */
    public function getAssets()
    {
        return array(
            'js' => array(
                '@MapbenderWmsBundle/Resources/public/mapbender.wms.dimension.js',
                '@MapbenderWmsBundle/Resources/public/mapbender.element.dimensionshandler.js',
            ),
            'css' => array(
                '@MapbenderWmsBundle/Resources/public/sass/element/dimensionshandler.scss',
                '@MapbenderCoreBundle/Resources/public/sass/element/mbslider.scss',
            ),
            'trans' => array(
                'MapbenderWmsBundle:Element:dimensionshandler.json.twig',
            ),
        );
    }

    /**
     * @inheritdoc
     */
    public static function getType()
    {
        return 'Mapbender\WmsBundle\Element\Type\DimensionsHandlerAdminType';
    }

    /**
     * @inheritdoc
     */
    public static function getFormTemplate()
    {
        return 'MapbenderWmsBundle:ElementAdmin:dimensionshandler.html.twig';
    }

    public function getFrontendTemplatePath($suffix = '.html.twig')
    {

        if (in_array($this->entity->getRegion(), array('toolbar', 'footer'))) {
            return "MapbenderWmsBundle:Element:dimensionshandler.toolbar{$suffix}";
        } else {
            return "MapbenderWmsBundle:Element:dimensionshandler{$suffix}";
        }
    }

    /**
     * @inheritdoc
     */
    public function getConfiguration()
    {
        $configuration = parent::getConfiguration();
        foreach ($configuration['dimensionsets'] as $setKey => $setConfig) {
            if (!empty($setConfig['dimension']) && is_object($setConfig['dimension'])) {
                /** @var DimensionInst $dimension */
                $dimension = $setConfig['dimension'];
                $configuration['dimensionsets'][$setKey]['dimension'] = array(
                    'name' => $dimension->getName(),
                    'extent' => DimensionInst::getData($dimension->getExtent()),
                );
            }
        }
        return $configuration;
    }
}
