<?php

namespace Mapbender\CoreBundle\Element;

use Mapbender\CoreBundle\Component\ElementBase\ConfigMigrationInterface;
use Mapbender\CoreBundle\Entity;

/**
 * Class GpsPosition
 * @package Mapbender\CoreBundle\Element
 */
class GpsPosition extends BaseButton implements ConfigMigrationInterface
{

    /**
     * @inheritdoc
     */
    public static function getClassTitle()
    {
        return "mb.core.gpsposition.class.title";
    }

    /**
     * @inheritdoc
     */
    public static function getClassDescription()
    {
        return "mb.core.gpsposition.class.description";
    }

    /**
     * @inheritdoc
     */
    public function getAssets()
    {
        return array(
            'js'    => array(
                '@MapbenderCoreBundle/Resources/public/mapbender.element.gpsPosition.js',
                // Uncomment to enable Geolocation API mock
                // '@MapbenderCoreBundle/Resources/public/GeolocationMock.js',
            ),
            'css'   => array(
                '@MapbenderCoreBundle/Resources/public/sass/element/gpsposition.scss',
            ),
            'trans' => array(
                'mb.core.gpsposition.*',
            ),
        );
    }

    /**
     * @inheritdoc
     */
    public static function getType()
    {
        return 'Mapbender\CoreBundle\Element\Type\GpsPositionAdminType';
    }

    /**
     * @inheritdoc
     */
    public static function getDefaultConfiguration()
    {
        return array_replace(parent::getDefaultConfiguration(), array(
            'autoStart'             => false,
            'target'                => null,
            'icon' => 'iconGps',
            'average'               => 1,
            'follow'                => false,
            'centerOnFirstPosition' => true,
            'zoomToAccuracyOnFirstPosition' => true,
        ));
    }

    /**
     * @inheritdoc
     */
    public function getWidgetName()
    {
        return 'mapbender.mbGpsPosition';
    }

    public function getFrontendTemplatePath($suffix = '.html.twig')
    {
        return 'MapbenderCoreBundle:Element:gpsposition.html.twig';
    }

    /**
     * @inheritdoc
     */
    public function render()
    {
        $configuration = $this->getConfiguration();
        return $this->container->get('templating')
            ->render($this->getFrontendTemplatePath(), array(
                    'id' => $this->getId(),
                    'configuration' => $configuration,
                    'title' => $this->getTitle(),
        ));
    }

    /**
     * @inheritdoc
     */
    public static function getFormTemplate()
    {
        return 'MapbenderManagerBundle:Element:gpsposition.html.twig';
    }

    public static function updateEntityConfig(Entity\Element $entity)
    {
        $config = $entity->getConfiguration() ?: array();
        if (!empty($config['zoomToAccuracy']) && isset($config['centerOnFirstPosition'])) {
            $config['zoomToAccuaryOnFirstPosition'] = $config['centerOnFirstPosition'];
        }
        unset($config['zoomToAccuracy']);
        $entity->setConfiguration($config);
    }
}
