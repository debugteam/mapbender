<?php

namespace Mapbender\WmsBundle\Element;

use Doctrine\ORM\EntityRepository;
use Mapbender\CoreBundle\Component\Element;
use Mapbender\CoreBundle\Component\Source\TypeDirectoryService;
use Mapbender\CoreBundle\Entity\SourceInstance;
use Mapbender\ManagerBundle\Form\Model\HttpOriginModel;
use Mapbender\WmsBundle\Component\Wms\Importer;
use Mapbender\WmsBundle\Entity\WmsSource;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Acl\Domain\ObjectIdentity;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;

/**
 * WmsLoader
 *
 * @author Karim Malhas
 * @author Paul Schmidt
 */
class WmsLoader extends Element
{

    /**
     * @inheritdoc
     */
    public static function getClassTitle()
    {
        return "mb.wms.wmsloader.class.title";
    }

    /**
     * @inheritdoc
     */
    public static function getClassDescription()
    {
        return "mb.wms.wmsloader.class.description";
    }

    /**
     * @inheritdoc
     */
    public static function getDefaultConfiguration()
    {
        return array(
            "tooltip" => "",
            "target" => null,
            "autoOpen" => false,
            "defaultFormat" => "image/png",
            "defaultInfoFormat" => "text/html",
            "splitLayers" => false,
        );
    }

    /**
     * @inheritdoc
     */
    public function getWidgetName()
    {
        return 'mapbender.mbWmsloader';
    }

    /**
     * @inheritdoc
     */
    public function getConfiguration()
    {
        $configuration = parent::getConfiguration();

        /** @var Request $request */
        $request = $this->container->get('request_stack')->getCurrentRequest();
        if ($request->get('wms_url')) {
            $wms_url = $request->get('wms_url');
            $all = $request->query->all();
            foreach ($all as $key => $value) {
                if (strtolower($key) === "version" && stripos($wms_url, "version") === false) {
                    $wms_url .= "&version=" . $value;
                } elseif (strtolower($key) === "request" && stripos($wms_url, "request") === false) {
                    $wms_url .= "&request=" . $value;
                } elseif (strtolower($key) === "service" && stripos($wms_url, "service") === false) {
                    $wms_url .= "&service=" . $value;
                }
            }
            $configuration['wms_url'] = urldecode($wms_url);
        }
        if ($request->get('wms_id')) {
            $wmsId = $request->get('wms_id');
            $configuration['wms_id'] = $wmsId;
        }
        return $configuration;
    }

    /**
     * @inheritdoc
     */
    public function getAssets()
    {
        return array(
            'js' => array(
                '@MapbenderWmsBundle/Resources/public/mapbender.element.wmsloader.js',
            ),
            'css' => array(
                '@MapbenderWmsBundle/Resources/public/sass/element/wmsloader.scss',
            ),
            'trans' => array(
                'mb.wms.wmsloader.error.*',
            ),
        );
    }

    /**
     * @inheritdoc
     */
    public static function getType()
    {
        return 'Mapbender\WmsBundle\Element\Type\WmsLoaderAdminType';
    }

    /**
     * @inheritdoc
     */
    public static function getFormTemplate()
    {
        return 'MapbenderWmsBundle:ElementAdmin:wmsloader.html.twig';
    }

    public function getFrontendTemplatePath($suffix = '.html.twig')
    {
        return 'MapbenderWmsBundle:Element:wmsloader.html.twig';
    }

    /**
     * @inheritdoc
     */
    public function render()
    {
        return $this->container->get('templating')
            ->render($this->getFrontendTemplatePath(), array(
                'id' => $this->getId(),
                "title" => $this->getTitle(),
                'example_url' => $this->container->getParameter('wmsloader.example_url'),
                'configuration' => $this->getConfiguration(),
        ));
    }

    /**
     * @inheritdoc
     */
    public function handleHttpRequest(Request $request)
    {
        $action = $request->attributes->get('action');
        switch ($action) {
            case 'getInstances':
                $instanceIds = array_filter(explode(',', $request->get('instances', '')));
                return new JsonResponse(array(
                    'success' => $this->getDatabaseInstanceConfigs($instanceIds),
                ));
            case 'loadWms':
                return $this->loadWms($request);
            default:
                throw new NotFoundHttpException("Unknown action {$action}");
        }
    }

    protected function loadWms(Request $request)
    {
        $source = $this->getSource($request);
        $instance = $this->getSourceTypeDirectory()->createInstance($source);

        $sourceService = $this->getSourceService($instance);
        $layerConfiguration = $sourceService->getConfiguration($instance);
        $config = array_replace($this->getDefaultConfiguration(), $this->entity->getConfiguration());
        if ($config['splitLayers']) {
            $layerConfigurations = $this->splitLayers($layerConfiguration);
        } else {
            $layerConfigurations = [$layerConfiguration];
        }
        // amend info_format and format options
        foreach ($layerConfigurations as &$layerConfiguration) {
            $layerConfiguration['configuration']['options']['info_format'] = $config['defaultInfoFormat'];
            $layerConfiguration['configuration']['options']['format'] = $config['defaultFormat'];
        }

        return new JsonResponse($layerConfigurations);
    }

    /**
     * @param Request $request
     * @return WmsSource
     */
    protected function getSource($request)
    {
        $origin = new HttpOriginModel();
        $origin->setOriginUrl($request->get("url"));
        $origin->setUsername($request->get("username"));
        $origin->setPassword($request->get("password"));
        /** @var Importer $importer */
        $importer = $this->container->get('mapbender.importer.source.wms.service');
        return $importer->evaluateServer($origin);
    }

    protected function splitLayers($layerConfiguration)
    {
        $children = $layerConfiguration['configuration']['children'][0]['children'];
        $layerConfigurations = array();
        foreach ($children as $child) {
            $layerConfiguration['configuration']['children'][0]['children'] = [$child];
            $layerConfiguration['configuration']['children'][0]['options']['title'] = $child['options']['title']
                . ' ('
                . $layerConfiguration['configuration']['title']
                . ')'
            ;
            $layerConfigurations[] = $layerConfiguration;
        }
        return $layerConfigurations;
    }

    /**
     * @param string[] $instanceIds
     * @return array
     */
    protected function getDatabaseInstanceConfigs(array $instanceIds)
    {
        /** @var AuthorizationCheckerInterface $suthorizationChecker */
        $suthorizationChecker = $this->container->get('security.authorization_checker');
        /** @var EntityRepository $repository */
        $repository = $this->container->get('doctrine')->getRepository('MapbenderCoreBundle:SourceInstance');
        $instanceConfigs = array();
        $sourceOid = new ObjectIdentity('class', 'Mapbender\CoreBundle\Entity\Source');
        foreach ($instanceIds as $instanceId) {
            /** @var SourceInstance $instance */
            $instance = $repository->find($instanceId);
            if ($instance && $suthorizationChecker->isGranted('VIEW', $sourceOid)) {
                $instanceConfigs[] = $this->getSourceService($instance)->getConfiguration($instance);
            }
        }
        return $instanceConfigs;
    }

    protected function getSourceTypeDirectory()
    {
        /** @var TypeDirectoryService $directory */
        $directory = $this->container->get('mapbender.source.typedirectory.service');
        return $directory;
    }

    /**
     * @param SourceInstance $instance
     * @return \Mapbender\CoreBundle\Component\Presenter\SourceService|null
     */
    protected function getSourceService($instance)
    {
        return $this->getSourceTypeDirectory()->getSourceService($instance);
    }
}
