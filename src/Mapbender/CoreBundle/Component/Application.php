<?php
namespace Mapbender\CoreBundle\Component;

use Assetic\Asset\StringAsset;
use Doctrine\Common\Persistence\ObjectRepository;
use Mapbender\CoreBundle\Component\Element as ElementComponent;
use Mapbender\CoreBundle\Component\Presenter\Application\ConfigService;
use Mapbender\CoreBundle\Component\Presenter\ApplicationService;
use Mapbender\CoreBundle\Entity\Application as Entity;
use Mapbender\CoreBundle\Entity\Element as ElementEntity;
use Mapbender\CoreBundle\Entity\Layerset;
use Mapbender\CoreBundle\Entity\SourceInstance;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Security\Acl\Domain\ObjectIdentity;
use Symfony\Component\Security\Acl\Domain\RoleSecurityIdentity;
use Symfony\Component\Security\Acl\Permission\MaskBuilder;

/**
 * Application is the main Mapbender3 class.
 *
 * This class is the controller for each application instance.
 * The application class will not perform any access checks, this is due to
 * the controller instantiating an application. The controller should check
 * with the configuration entity to get a list of allowed roles and only then
 * decide to instantiate a new application instance based on the configuration
 * entity.
 *
 * @author Christian Wygoda
 */
class Application implements IAssetDependent
{
    /**
     * @var ContainerInterface $container The container
     */
    protected $container;

    /**
     * @var Template $template The application template class
     */
    protected $template;

    /**
     * @var Element[][] $element lists by region
     */
    protected $elements;

    /**
     * @var array $layers The layers
     */
    protected $layers;

    /**
     * @var Entity
     */
    protected $entity;

    /**
     * @param ContainerInterface $container The container
     * @param Entity             $entity    The configuration entity
     */
    public function __construct(ContainerInterface $container, Entity $entity)
    {
        $this->container = $container;
        $this->entity    = $entity;
    }

    /**
     * Get the configuration entity.
     *
     * @return Entity $entity
     */
    public function getEntity()
    {
        return $this->entity;
    }

    /**
     * Get the application ID
     *
     * @return integer
     */
    public function getId()
    {
        return $this->entity->getId();
    }

    /**
     * Get the application slug
     *
     * @return string
     */
    public function getSlug()
    {
        return $this->entity->getSlug();
    }

    /**
     * Get the application title
     *
     * @return string
     */
    public function getTitle()
    {
        return $this->entity->getTitle();
    }

    /**
     * Get the application description
     *
     * @return string
     */
    public function getDescription()
    {
        return $this->entity->getDescription();
    }

    /*************************************************************************
     *                                                                       *
     *                              Frontend stuff                           *
     *                                                                       *
     *************************************************************************/

    /**
     * Render the application
     *
     * @return string $html The rendered HTML
     */
    public function render()
    {
        $template = $this->getTemplate();
        return $template->render();
    }

    /**
     *
     * @return string[]
     */
    public function getValidAssetTypes()
    {
        return array(
            'js',
            'css',
            'trans',
        );
    }

    /**
     * Lists map-engine specific asset references in same format as getAssets
     *
     * @return string[][]
     */
    public function getMapEngineAssets()
    {
        $engineCode = $this->entity->getMapEngineCode();
        switch ($engineCode) {
            case 'mq-ol2':
                return array(
                    'js' => array(
                        '@MapbenderCoreBundle/Resources/public/init/projection.js',
                        '@MapbenderCoreBundle/Resources/public/mapbender.model.js',
                        '/components/mapquery/lib/openlayers/OpenLayers.js',
                        // @todo: figure out why this tmpl extension is here, potentially safe to remove entirely
                        '../vendor/mapbender/mapquery/lib/jquery/jquery.tmpl.js',
                        '/components/mapquery/src/jquery.mapquery.core.js',
                    ),
                );
            case 'ol4':
                if ($this->container->get('kernel')->getEnvironment()=== 'dev'){
                    $ol4 = '/components/openlayers/ol-debug.js';
                    $proj4js = '/components/proj4js/dist/proj4-src.js';
                } else {
                    $ol4 = '/components/openlayers/ol.js';
                    $proj4js = '/components/proj4js/dist/proj4.js';
                }

                $coreJsBase = '@MapbenderCoreBundle/Resources/public';
                $modelJsBase = "$coreJsBase/mapbender-model";
                return array(
                    'js' => array(
                        $ol4,
                        $proj4js,
                        '@MapbenderCoreBundle/Resources/public/init/projection.js',
                        "$modelJsBase/mapbender.model.ol4.source.js",
                        "$coreJsBase/mapbender.model.ol4.js",
                        "$modelJsBase/mapbender.model.ol4.sourcelayer.state.js",
                        "$modelJsBase/mapbender.model.mappopup.js",

                    ), 'css' => array("$coreJsBase/sass/modules/mapPopup.scss"));
            default:
                throw new \RuntimeException("Unhandled map engine code " . print_r($engineCode, true));

        }
    }

    /**
     * Lists assets.
     *
     * @return string[]
     */
    public function getAssets()
    {
        $assetRefs = array(
            'js'    => array(
                '@MapbenderCoreBundle/Resources/public/stubs.js',
                '@MapbenderCoreBundle/Resources/public/mapbender.application.js',
                '@MapbenderCoreBundle/Resources/public/mapbender-model/sourcetree-util.js',
            ),
            'css'   => array(),
            'trans' => array('@MapbenderCoreBundle/Resources/public/mapbender.trans.js')
        );
        $afterEngineAssets = array(
            'js' => array(
                '@MapbenderCoreBundle/Resources/public/mapbender.trans.js',
                '@MapbenderCoreBundle/Resources/public/mapbender.application.wdt.js',
                '@MapbenderCoreBundle/Resources/public/mapbender.element.base.js',
                '@MapbenderCoreBundle/Resources/public/polyfills.js',
            ),
        );
        // append map engine specific asset refs
        foreach ($this->getMapEngineAssets() as $groupKey => $engineRefs) {
            $assetRefs[$groupKey] = array_merge($assetRefs[$groupKey], $engineRefs);
        }
        // append more asset refs *after* engine-specific refs
        foreach ($afterEngineAssets as $groupKey => $extraRefs) {
            $assetRefs[$groupKey] = array_merge($assetRefs[$groupKey], $extraRefs);
        }
        return $assetRefs;
    }

    /**
     * Get the list of asset paths of the given type ('css', 'js', 'trans')
     * Filters can be applied later on with the ensureFilter method.
     *
     * @param string $type use 'css' or 'js' or 'trans'
     * @return string[]
     */
    public function getAssetGroup($type)
    {
        if (!\in_array($type, $this->getValidAssetTypes(), true)) {
            throw new \RuntimeException('Asset type \'' . $type .
                '\' is unknown.');
        }

        // Add all assets to an asset manager first to avoid duplication
        //$assets = new LazyAssetManager($this->container->get('assetic.asset_factory'));
        $assets            = array();
        $templating        = $this->container->get('templating');
        $appTemplate = $this->getTemplate();

        $ownAssets = $this->getAssets();
        if (!empty($ownAssets[$type])) {
            $assets = array_merge($assets, $ownAssets[$type]);
        }
        $assetSources = array(
            array(
                'object' => $appTemplate,
                'assets' => array(
                    $type => $appTemplate->getAssets($type),
                ),
            ),
        );

        // Collect asset definitions from elements configured in the application
        // Skip grants checks here to avoid issues with application asset caching.
        // Non-granted Elements will skip HTML rendering and config and will not be initialized.
        // Emitting the base js / css / translation assets OTOH is always safe to do
        foreach ($this->getService()->getActiveElements($this->entity, false) as $element) {
            $assetSources[] = array(
                'object' => $element,
                'assets' => $element->getAssets(),
            );
        }

        // Collect all layer asset definitions
        foreach ($this->entity->getLayersets() as $layerset) {
            foreach ($this->filterActiveSourceInstances($layerset) as $layer) {
                $assetSources[] = array(
                    'object' => $layer,
                    'assets' => $layer->getAssets(),
                );
            }
        }

        // Load the late template assets last, so they can overwrite element and layer assets
        $assetSources[] = array(
            'object' => $appTemplate,
            'assets' => array(
                $type => $appTemplate->getLateAssets($type),
            ),
        );

        if ($type === 'trans') {
            // mimic old behavior: ONLY for trans assets, avoid processing repeated inputs
            $transAssetInputs = array();
            $translations = array();
            foreach ($assetSources as $assetSource) {
                if (!empty($assetSource['assets'][$type])) {
                    foreach (array_unique($assetSource['assets'][$type]) as $transAsset) {
                        $transAssetInputs[$transAsset] = $transAsset;
                    }
                }
            }
            foreach ($transAssetInputs as $transAsset) {
                $renderedTranslations = json_decode($templating->render($transAsset), true);
                $translations         = array_merge($translations, $renderedTranslations);
            }
            $assets[] = new StringAsset('Mapbender.i18n = ' . json_encode($translations, JSON_FORCE_OBJECT) . ';');
        } else {
            $assetRefs = array();
            foreach ($assetSources as $assetSource) {
                if (!empty($assetSource['assets'][$type])) {
                    foreach ($assetSource['assets'][$type] as $asset) {
                        $assetRef = $this->getReference($assetSource['object'], $asset);
                        if (!array_key_exists($assetRef, $assetRefs)) {
                            $assets[] = $assetRef;
                            $assetRefs[$assetRef] = true;
                        }
                    }
                }
            }
        }

        // Append `extra_assets` references (only occurs in YAML application, see ApplicationYAMLMapper)
        $extraYamlAssets = $this->getEntity()->getExtraAssets();
        if (is_array($extraYamlAssets) && array_key_exists($type, $extraYamlAssets)) {
            foreach ($extraYamlAssets[$type] as $asset) {
                $assets[] = trim($asset);
            }
        }

        // add client initialization last, so everything is already in place
        if ($type === 'js') {
            $appLoaderTemplate = '@MapbenderCoreBundle/Resources/views/application.config.loader.js.twig';
            $appLoaderContent = $templating->render($appLoaderTemplate, array(
                'application' => $this,
            ));
            $assets[] = new StringAsset($appLoaderContent);
        }

        if ($type === 'css') {
            $customCss = $this->getEntity()->getCustomCss();
            if ($customCss) {
                $assets[] = new StringAsset($customCss);
            }
        }

        return $assets;
    }

    /**
     * @return ConfigService
     */
    private function getConfigService()
    {
        /** @var ConfigService $presenter */
        $presenter = $this->container->get('mapbender.presenter.application.config.service');
        return $presenter;
    }

    /**
     * Get the configuration (application, elements, layers) as an StringAsset.
     * Filters can be applied later on with the ensureFilter method.
     *
     * @return string Configuration as JSON string
     */
    public function getConfiguration()
    {
        $configService = $this->getConfigService();
        $configuration = $configService->getConfiguration($this->entity);

        // Convert to asset
        $asset = new StringAsset(json_encode((object)$configuration));
        return $asset->dump();
    }

    /**
     * Return the element with the given id
     *
     * @param string $id The element id
     * @return ElementComponent
     */
    public function getElement($id)
    {
        /** @var Element[] $elements */
        $regions = $this->getElements();
        $r       = null;
        foreach ($regions as $region => $elements) {
            foreach ($elements as $element) {
                if ($id == $element->getId()) {
                    $r = $element;
                    break;
                }
            }
        }
        return $r;
    }

    /**
     * Build an Assetic reference path from a given objects bundle name(space)
     * and the filename/path within that bundles Resources/public folder.
     *
     * @todo: This is duplicated in DumpMapbenderAssetsCommand
     * @todo: the AssetFactory should do the ref collection and Bundle => path resolution
     *
     * @param object $object
     * @param string $file
     * @return string
     */
    private function getReference($object, $file)
    {
        // If it starts with an @ we assume it's already an assetic reference
        $firstChar = $file[0];
        if ($firstChar == "/") {
            return "../../web/" . substr($file, 1);
        } elseif ($firstChar == ".") {
            return $file;
        } elseif ($firstChar !== '@') {
            if (!$object) {
                throw new \RuntimeException("Can't resolve asset path $file with empty object context");
            }
            $namespaces = explode('\\', get_class($object));
            $bundle     = sprintf('%s%s', $namespaces[0], $namespaces[1]);
            return sprintf('@%s/Resources/public/%s', $bundle, $file);
        } else {
            return $file;
        }
    }

    /**
     * Get template object
     *
     * @return Template
     */
    public function getTemplate()
    {
        if (!$this->template) {
            $template       = $this->entity->getTemplate();
            $this->template = new $template($this->container, $this);
        }
        return $this->template;
    }

    /**
     * Get region elements, optionally by region
     *
     * @param string $regionName deprecated; Region to get elements for. If null, all elements  are returned.
     * @return Element[][] keyed by region name (string)
     */
    public function getElements($regionName = null)
    {
        if (!$this->elements) {
            $regions = $this->getGrantedRegionElementCollections();
            foreach ($regions as $_regionName => $elements) {
                //$_elements               = $this->sortElementsByWidth($elements);
                $regions[ $_regionName ] = $elements;
            }
            $this->elements = $regions;
        }

        if ($regionName) {
            $hasRegionElements = array_key_exists($regionName, $this->elements);
            $regions           = $hasRegionElements ? $this->elements[ $regionName ] : array();
        } else {
            $regions = $this->elements;
        }

        return $regions;
    }

    /**
     * Returns all layer sets
     *
     * @deprecated for entity-modifying side effects, do not use
     * @return Layerset[] Layer sets
     */
    public function getLayersets()
    {
        if ($this->layers === null) {
            $this->layers = array();
            foreach ($this->entity->getLayersets() as $layerSet) {
                $layerSet->layerObjects = $this->filterActiveSourceInstances($layerSet);
                $this->layers[$layerSet->getId()] = $layerSet;
            }
        }
        return $this->layers;
    }

    /**
     * Extracts active source instances from given Layerset entity.
     *
     * @param Layerset $entity
     * @return SourceInstance[]
     */
    protected static function filterActiveSourceInstances(Layerset $entity)
    {
        $isYamlApp = $entity->getApplication()->isYamlBased();
        $activeInstances = array();
        foreach ($entity->getInstances() as $instance) {
            if ($isYamlApp || $instance->getEnabled()) {
                $activeInstances[] = $instance;
            }
        }
        return $activeInstances;
    }

    /**
     * Checks and generates a valid slug.
     *
     * @param ContainerInterface $container container
     * @param string             $slug      slug to check
     * @param string             $suffix
     * @return string a valid generated slug
     */
    public static function generateSlug($container, $slug, $suffix = 'copy')
    {
        $application = $container->get('mapbender')->getApplicationEntity($slug);
        if (!$application) {
            return $slug;
        } else {
            $count = 0;
        }
        /** @var ObjectRepository $rep */
        $rep = $container->get('doctrine')->getRepository('MapbenderCoreBundle:Application');
        do {
            $copySlug = $slug . "_" . $suffix . ($count > 0 ? '_' . $count : '');
            $count++;
        } while ($rep->findOneBy(array('slug' => $copySlug)));
        return $copySlug;
    }

    /**
     * Returns the public "uploads" directory.
     *
     * @param ContainerInterface $container Container
     * @param bool               $webRelative
     * @return string the path to uploads dir or null.
     */
    public static function getUploadsDir($container, $webRelative = false)
    {
        $uploads_dir = $container->get('kernel')->getRootDir() . '/../web/'
            . $container->getParameter("mapbender.uploads_dir");
        $ok          = true;
        if (!is_dir($uploads_dir)) {
            $ok = mkdir($uploads_dir);
        }
        if ($ok) {
            if (!$webRelative) {
                return $uploads_dir;
            } else {
                return $container->getParameter("mapbender.uploads_dir");
            }
        } else {
            return null;
        }
    }

    /**
     * Returns the application's public directory.
     *
     * @param ContainerInterface $container Container
     * @param string             $slug      application's slug
     * @return boolean true if the application's directories are created or exist otherwise false.
     */
    public static function getAppWebDir($container, $slug)
    {
        return Application::createAppWebDir($container, $slug)
            ? Application::getUploadsDir($container, $slug) . "/" . $slug
            : null;
    }

    /**
     * Creates or checks if the application's public directory is created or exist.
     *
     * @param ContainerInterface $container Container
     * @param string             $slug      application's slug
     * @param string             $old_slug  the old application's slug.
     * @return boolean true if the application's directories are created or
     *                                      exist otherwise false.
     */
    public static function createAppWebDir($container, $slug, $old_slug = null)
    {
        $uploads_dir = Application::getUploadsDir($container);
        if ($uploads_dir === null) {
            return false;
        }
        if ($old_slug === null) {
            $slug_dir = $uploads_dir . "/" . $slug;
            if (!is_dir($slug_dir)) {
                return mkdir($slug_dir, 0777, true);
            } else {
                return true;
            }
        } else {
            $old_slug_dir = $uploads_dir . "/" . $old_slug;
            if (is_dir($old_slug_dir)) {
                $slug_dir = $uploads_dir . "/" . $slug;
                return rename($old_slug_dir, $slug_dir);
            } else {
                if (mkdir($old_slug_dir)) {
                    $slug_dir = $uploads_dir . "/" . $slug;
                    return rename($old_slug_dir, $slug_dir);
                } else {
                    return false;
                }
            }
        }
    }

    /**
     * Removes application's public directoriy.
     *
     * @param ContainerInterface $container Container
     * @param string             $slug      application's slug
     * @return boolean true if the directories are removed or not exist otherwise false
     */
    public static function removeAppWebDir($container, $slug)
    {
        $uploads_dir = Application::getUploadsDir($container);
        if (!is_dir($uploads_dir)) {
            return true;
        }
        $slug_dir = $uploads_dir . "/" . $slug;
        if (!is_dir($slug_dir)) {
            return true;
        } else {
            return Utils::deleteFileAndDir($slug_dir);
        }
    }

    /**
     * Returns an url to application's public directory.
     *
     * @param ContainerInterface $container Container
     * @param string             $slug      application's slug
     * @return string a url to wmc directory or to file with "$filename"
     */
    public static function getAppWebUrl($container, $slug)
    {
        return Application::getUploadsUrl($container) . "/" . $slug;
    }

    /**
     * Returns an url to public "uploads" directory.
     *
     * @param ContainerInterface $container Container
     * @return string an url to public "uploads" directory
     */
    public static function getUploadsUrl($container)
    {
        $base_url = Application::getBaseUrl($container);
        return $base_url . '/' . Application::getUploadsDir($container, true);
    }

    /**
     * Returns a base url.
     *
     * @param ContainerInterface $container Container
     * @return string a base url
     */
    public static function getBaseUrl($container)
    {
        $request = $container->get('request');
        return $request->getScheme() . '://' . $request->getHttpHost() . $request->getBasePath();
    }

    /**
     * Copies an application web order.
     *
     * @param ContainerInterface $container Container
     * @param string             $srcSslug  source application slug
     * @param string             $destSlug  destination application slug
     * @return boolean true if the application  order has been copied otherwise false.
     */
    public static function copyAppWebDir($container, $srcSslug, $destSlug)
    {
        $rootPath = $container->get('kernel')->getRootDir() . '/../web/';
        $src      = Application::getAppWebDir($container, $srcSslug);
        $dst      = Application::getAppWebDir($container, $destSlug);

        if ($src === null || $dst === null) {
            return false;
        }

        Utils::copyOrderRecursive($rootPath . $src, $rootPath . $dst);
        return true;
    }

    /**
     * Sort region elements by width
     *
     * @param $elements
     * @return ElementComponent[]
     */
    protected function sortElementsByWidth($elements)
    {
        return usort($elements, function (ElementComponent $a, ElementComponent $b) {
            $wa = $a->getEntity()->getWeight();
            $wb = $b->getEntity()->getWeight();
            if ($wa == $wb) {
                return 0;
            }
            return ($wa < $wb) ? -1 : 1;
        });
    }



    /**
     * Get granted elements
     *
     * @return Element[][] keyed on region name
     */
    protected function getGrantedRegionElementCollections()
    {
        $application = $this->entity;
        $elements    = array();
        foreach ($application->getElements() as $elementEntity) {
            if (!$elementEntity->getEnabled() || !$this->isElementGranted($elementEntity)) {
                continue;
            }

            /** @var \Mapbender\CoreBundle\Element\Button $class */
            $class                     = $elementEntity->getClass();
            if (!class_exists($class)) {
                continue;
            }

            $elementComponent          = new $class($this, $this->container, $elementEntity);
            $regionName                = $elementEntity->getRegion();
            $elements[ $regionName ][] = $elementComponent;
        }
        return $elements;
    }

    /**
     * Is element granted?
     *
     * If there is no ACL's or roles then ever granted
     *
     * @param Element|ElementEntity $element
     * @param string $permission SecurityContext::PERMISSION_
     * @return bool
     */
    public function isElementGranted(ElementEntity $element, $permission = SecurityContext::PERMISSION_VIEW)
    {
        $applicationEntity = $this->getEntity();
        $securityContext   = $this->container->get('security.context');
        $aclManager        = $this->container->get("fom.acl.manager");
        $isGranted         = true;

        if ($aclManager->hasObjectAclEntries($element)) {
            $isGranted = $securityContext->isGranted($permission, $element);
        }

        if ($applicationEntity->isYamlBased() && count($element->getYamlRoles())) {
            foreach ($element->getYamlRoles() as $role) {
                if ($securityContext->isGranted($role)) {
                    $isGranted = true;
                    break;
                }
            }
        }

        return $isGranted;
    }

    /**
     * Add view permissions
     */
    public function addViewPermissions()
    {
        $aclProvider       = $this->container->get('security.acl.provider');
        $applicationEntity = $this->getEntity();
        $maskBuilder       = new MaskBuilder();
        $uoid              = ObjectIdentity::fromDomainObject($applicationEntity);

        $maskBuilder->add('VIEW');

        try {
            $acl = $aclProvider->findAcl($uoid);
        } catch (\Exception $e) {
            $acl = $aclProvider->createAcl($uoid);
        }

        $acl->insertObjectAce(new RoleSecurityIdentity('IS_AUTHENTICATED_ANONYMOUSLY'), $maskBuilder->get());
        $aclProvider->updateAcl($acl);
    }

    /**
     * @return ApplicationService
     */
    protected function getService()
    {
        /** @var ApplicationService $service */
        $service = $this->container->get('mapbender.presenter.application.service');
        return $service;
    }
}
