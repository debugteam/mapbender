<?php


namespace Mapbender\CoreBundle\Element;


class ShareUrl extends BaseButton
{
    // Disable being targetted by a Button
    public static $ext_api = false;

    public static function getClassTitle()
    {
        return 'mb.core.ShareUrl.class.title';
    }

    public static function getClassDescription()
    {
        return 'mb.core.ShareUrl.class.description';
    }

    public function getWidgetName()
    {
        return 'mapbender.mbShareUrl';
    }

    public static function getType()
    {
        return 'Mapbender\CoreBundle\Element\Type\ShareUrlAdminType';
    }

    /**
     * @inheritdoc
     */
    public function getAssets()
    {
        return array(
            'js' => array(
                '@MapbenderCoreBundle/Resources/public/element/mbShareUrl.js',
            ),
            'css' => array(
                '@MapbenderCoreBundle/Resources/public/sass/element/button.scss',
                '@MapbenderCoreBundle/Resources/public/element/mbShareUrl.scss',
            ),
            'trans' => array(
                'mb.core.ShareUrl.*',
            ),
        );
    }

    public static function getDefaultConfiguration()
    {
        $defaults = parent::getDefaultConfiguration();
        // icon is hard-coded (see twig template)
        unset($defaults['icon']);
        return $defaults;
    }

    public function getFrontendTemplatePath($suffix = '.html.twig')
    {
        return "MapbenderCoreBundle:Element:ShareUrl.html.twig";
    }
}
