<?php


namespace Mapbender\CoreBundle\Asset;

use Assetic\Asset\StringAsset;
use Symfony\Component\Config\FileLocatorInterface;

/**
 * Common base class for JsCompiler and CssCompiler
 *
 * @since v3.0.7.7
 */
class AssetFactoryBase
{
    /** @var string */
    protected $webDir;
    /** @var FileLocatorInterface */
    protected $fileLocator;
    /** @var string[] */
    protected $publishedBundleNameMap;

    /**
     * @param FileLocatorInterface $fileLocator
     * @param string $webDir
     * @param string[] $bundleClassMap
     */
    public function __construct(FileLocatorInterface $fileLocator, $webDir, $bundleClassMap)
    {
        $this->fileLocator = $fileLocator;
        $this->webDir = $webDir;
        $this->publishedBundleNameMap = $this->initPublishedBundlePaths($bundleClassMap);
    }

    /**
     * Perform simple concatenation of all input assets. Some uniquification will take place.
     *
     * @param (FileAsset|StringAsset)[] $inputs
     * @param bool $debug to enable file input markers
     * @return string
     */
    protected function concatenateContents($inputs, $debug)
    {
        $parts = array();
        $uniqueRefs = array();
        $migratedRefMapping = $this->getMigratedReferencesMapping();

        foreach ($inputs as $input) {
            if ($input instanceof StringAsset) {
                $input->load();
                if ($debug) {
                    $parts[] = "/** !!! Emitting StringAsset content */";
                }
                $parts[] = $input->getContent();
            } else {
                $parts[] = $this->loadFileReference($input, $debug, $migratedRefMapping, $uniqueRefs);
            }
        }
        return implode("\n", $parts);
    }

    /**
     * @param string $input
     * @param bool $debug
     * @param array $migratedRefMapping
     * @param string[] $uniqueRefs
     * @return string
     */
    protected function loadFileReference($input, $debug, $migratedRefMapping, &$uniqueRefs)
    {
        $parts = array();
        $normalizedReferenceBeforeRemap = $this->normalizeReference($input);

        if (!empty($uniqueRefs[$normalizedReferenceBeforeRemap])) {
            if ($debug) {
                $parts[] = "/** !!! Skipping duplicate handling of {$normalizedReferenceBeforeRemap} (from original reference {$input}) */";
            }
            $normalizedReferences = array();
        } else {
            if ($debug) {
                $normalizedReferences = $this->rewriteReference($normalizedReferenceBeforeRemap, $migratedRefMapping, $parts);
            } else {
                $dummy = array();   // Let's all thank PHP for its sane reference passing semantics
                $normalizedReferences = $this->rewriteReference($normalizedReferenceBeforeRemap, $migratedRefMapping, $dummy);
            }
        }

        foreach ($normalizedReferences as $normalizedReference) {
            if (empty($uniqueRefs[$normalizedReference])) {
                $realAssetPath = $this->locateAssetFile($normalizedReference);
                if ($realAssetPath) {
                    if ($debug) {
                        $parts[] = $this->getDebugHeader($realAssetPath, $input);
                    }
                    $parts[] = file_get_contents($realAssetPath);
                } elseif ($debug) {
                    $parts[] = "/** !!! Ignoring reference to missing file {$normalizedReference} ((from original reference {$input}) */";
                }
                $uniqueRefs[$normalizedReference] = true;
            } elseif ($debug) {
                $parts[] = "/** !!! Skipping duplicate emission of {$normalizedReference} (from original reference {$input}) */";
            }
        }
        $uniqueRefs[$normalizedReferenceBeforeRemap] = true;
        return implode("\n", $parts);
    }

    /**
     * @param string $normalizedReference
     * @param array $migratedRefMapping
     * @param string[] &$debugOutput
     * @return string[]
     */
    protected function rewriteReference($normalizedReference, $migratedRefMapping, &$debugOutput)
    {
        $refsOut = array();
        if (!empty($migratedRefMapping[$normalizedReference])) {
            $replacements = (array)$migratedRefMapping[$normalizedReference];
            $debugOutput[] = "/** !!! Replaced asset reference to {$normalizedReference} with " . implode(', ', $replacements) . " */";
            foreach ($replacements as $replacement) {
                if ($replacement === $normalizedReference) {
                    $refsOut[] = $replacement;
                } else {
                    foreach ($this->rewriteReference($replacement, $migratedRefMapping, $debugOutput) as $refOut) {
                        $refsOut[] = $refOut;
                    }
                }
            }
        } else {
            $refsOut[] = $normalizedReference;
        }
        return $refsOut;
    }

    /**
     * Calculates a mapping from published web-relative path containing a bundle's public assets to the bundle
     * name. Input is a mapping of canonical bundle name to bundle FQCN, as provided by Symfony's standard
     * kernel.bundles parameter.
     *
     * @param string[] $bundleClassMap
     * @return string[]
     */
    protected function initPublishedBundlePaths($bundleClassMap)
    {
        $nameMap = array();
        foreach (array_keys($bundleClassMap) as $bundleName) {
            $publishedPath = 'bundles/' . strtolower(preg_replace('#Bundle$#', '', $bundleName));
            $nameMap[$publishedPath] = $bundleName;
        }
        return $nameMap;
    }

    protected function getDebugHeader($finalPath, $originalRef)
    {
        return "\n"
            . "/** \n"
            . "  * BEGIN NEW ASSET INPUT -- {$finalPath}\n"
            . "  * (original reference: {$originalRef})\n"
            . "  */\n"
        ;
    }

    /**
     * @param string $input reference to an asset file
     * @return string|null resolved absolute path to file, or null if file is missing (and should be ignored)
     */
    protected function locateAssetFile($input)
    {
        if ($input[0] == '/') {
            $inWeb = $this->webDir . '/' . ltrim($input, '/');
            if (@is_file($inWeb) && @is_readable($inWeb)) {
                return realpath($inWeb);
            }
        }
        try {
            return $this->fileLocator->locate($input);
        } catch (\InvalidArgumentException $e) {
            if (preg_match('#^[/.]*?/vendor/#', $input)) {
                // Ignore /vendor/ reference (avoid depending on internal package structure)
                return null;
            } else {
                throw $e;
            }
        }
    }

    /**
     * Retranslates published asset reference ("/bundles/somename/apath/something.ext") back to bundle-scoped
     * reference ("@SomeNameBundle/Resources/public/apath/something.ext"), which allows FileLocator to pick
     * up resource overrides in app/Resources.
     *
     * @param string $input
     * @return string
     */
    protected function normalizeReference($input)
    {
        if ($input && preg_match('#^/bundles/.+/.+#', $input)) {
            $parts = explode('/', $input, 4);
            $publishedBundleName = $parts[2];
            if (!empty($this->publishedBundleNameMap[$publishedBundleName])) {
                $pathInside = $parts[3];
                return '@' . $this->publishedBundleNameMap[$publishedBundleName] . '/Resources/public/' . $pathInside;
            }
        }
        return $input;
    }

    /**
     * Should return a mapping of
     *   known old, no longer valid asset file reference => new, valid reference
     * @return string[]
     */
    protected function getMigratedReferencesMapping()
    {
        return array();
    }
}
