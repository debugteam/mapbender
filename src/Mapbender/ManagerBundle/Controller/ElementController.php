<?php
namespace Mapbender\ManagerBundle\Controller;

use Doctrine\Common\Collections\ArrayCollection;
use Mapbender\CoreBundle\Component\ElementFactory;
use Mapbender\ManagerBundle\Component\ElementFormFactory;
use Mapbender\ManagerBundle\Utils\WeightSortedCollectionUtil;
use Symfony\Component\HttpFoundation\JsonResponse;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManager;
use FOM\ManagerBundle\Configuration\Route as ManagerRoute;
use Mapbender\CoreBundle\Entity\Element;
use Mapbender\CoreBundle\Mapbender;
use Sensio\Bundle\FrameworkExtraBundle\Configuration\Method;
use Sensio\Bundle\FrameworkExtraBundle\Configuration\Template;
use Symfony\Bundle\FrameworkBundle\Controller\Controller;
use Symfony\Component\Form\Form;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Class ElementController
 *
 * @package Mapbender\ManagerBundle\Controller
 *
 * @author  Christian Wygoda <christian.wygoda@wheregroup.com>
 * @author  Andreas Schmitz <andreas.schmitz@wheregroup.com>
 * @author  Paul Schmidt <paul.schmidt@wheregroup.com>
 * @author  Andriy Oblivantsev <andriy.oblivantsev@wheregroup.com>
 */
class ElementController extends Controller
{
    /**
     * Show element class selection
     *
     * @ManagerRoute("/application/{slug}/element/select")
     * @Method({"GET","POST"})
     * @Template
     * @param Request $request
     * @param string $slug
     * @return array
     */
    public function selectAction(Request $request, $slug)
    {
        $application = $this->getMapbender()->getApplicationEntity($slug);
        $template    = $application->getTemplate();
        $region      = $request->get('region');
        $whitelist   = null;
        $classNames  = null;

        // Dirty hack for deprecated Responsive template
        if (method_exists($template, 'getElementWhitelist')) {
            $regionWhitelist = $template::getElementWhitelist();
            $classNames = $regionWhitelist[$region];
        } else {
            $classNames = $this->getMapbender()->getElements();
        }

        $trans      = $this->container->get('translator');
        $elements   = array();

        foreach ($classNames as $elementClassName) {
            $title = $trans->trans($elementClassName::getClassTitle());
            $tags = array();
            foreach ($elementClassName::getClassTags() as $tag) {
                $tags[] = $trans->trans($tag);
            }
            $elements[$title] = array(
                'class' => $elementClassName,
                'title' => $title,
                'description' => $trans->trans($elementClassName::getClassDescription()),
                'tags' => $tags,
            );
        }

        ksort($elements, SORT_LOCALE_STRING);
        return array(
            'elements' => $elements,
            'region' => $region,
        );
    }

    /**
     * Shows form for creating new element
     *
     * @ManagerRoute("/application/{slug}/element/new")
     * @Method("GET")
     * @Template("MapbenderManagerBundle:Element:edit.html.twig")
     * @param Request $request
     * @param string $slug
     * @return array Response
     */
    public function newAction(Request $request, $slug)
    {
        /** @var \Mapbender\CoreBundle\Component\Element $elementComponent */
        $application = $this->getMapbender()->getApplicationEntity($slug);
        $class       = $request->get('class'); // Get class for element

        if (!class_exists($class)) {
            throw new \RuntimeException('An Element class "' . $class
                . '" does not exist.');
        }

        $region               = $request->get('region');
        $element = $this->getFactory()->newEntity($class, $region, $application);
        $formFactory = $this->getFormFactory();
        $response = $formFactory->getConfigurationForm($element);
        $response["form"] = $response['form']->createView();
        $response += array(
            'formAction' => $this->generateUrl('mapbender_manager_element_create', array(
                'slug' => $slug,
            )),
        );

        return $response;
    }

    /**
     * Create a new element from POSTed data
     *
     * @ManagerRoute("/application/{slug}/element/new")
     * @Method("POST")
     * @Template("MapbenderManagerBundle:Element:edit.html.twig")
     * @param Request $request
     * @param string $slug
     * @return Response|array
     */
    public function createAction(Request $request, $slug)
    {
        $application = $this->getMapbender()->getApplicationEntity($slug);

        $data = $request->get('form');
        $element = $this->getFactory()->newEntity($data['class'], $data['region'], $application);
        $formFactory = $this->getFormFactory();
        $form = $formFactory->getConfigurationForm($element);

        $form['form']->submit($request);

        if ($form['form']->isValid()) {
            $em    = $this->getDoctrine()->getManager();
            $query = $em->createQuery(
                "SELECT e FROM MapbenderCoreBundle:Element e"
                . " WHERE e.region=:reg AND e.application=:app");
            $query->setParameters(array(
                "reg" => $element->getRegion(),
                "app" => $element->getApplication()->getId()));
            $elements = $query->getResult();
            $element->setWeight(count($elements) + 1);
            $application = $element->getApplication();
            $this->getDoctrine()->getManager()->persist($application->setUpdated(new \DateTime('now')));
            $em->persist($element);
            $em->flush();
            $this->get('session')->getFlashBag()->set('success',
                'Your element has been saved.');

            return new Response('', 201);
        } else {
            return array(
                'form' => $form['form']->createView(),
                'theme' => $form['theme'],
                'formAction' => $this->generateUrl('mapbender_manager_element_create', array(
                    'slug' => $slug,
                )),
            );
        }
    }

    /**
     * @ManagerRoute("/application/{slug}/element/{id}", requirements={"id" = "\d+"})
     * @Method("GET")
     * @Template("MapbenderManagerBundle:Element:edit.html.twig")
     */
    public function editAction($slug, $id)
    {
        /** @var Element|null $element */
        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->find($id);

        if (!$element) {
            throw $this->createNotFoundException('The element with the id "'
                . $id . '" does not exist.');
        }
        $formFactory = $this->getFormFactory();
        $form = $formFactory->getConfigurationForm($element);

        return array(
            'form' => $form['form']->createView(),
            'theme' => $form['theme'],
            'formAction' => $this->generateUrl('mapbender_manager_element_update', array(
                'slug' => $slug,
                'id' => $id,
            )),
        );
    }

    /**
     * Updates element by POSTed data
     *
     * @ManagerRoute("/application/{slug}/element/{id}", requirements = {"id" = "\d+" })
     * @Method("POST")
     * @Template("MapbenderManagerBundle:Element:edit.html.twig")
     * @param Request $request
     * @param string $slug
     * @param string $id
     * @return Response|array
     */
    public function updateAction(Request $request, $slug, $id)
    {
        /** @var Element $element */
        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->findOneBy(array('id' => $id));

        if (!$element) {
            throw $this->createNotFoundException('The element with the id "'
                . $id . '" does not exist.');
        }
        $formService = $this->getFormFactory();
        $form = $formService->getConfigurationForm($element);
        $form['form']->submit($request);

        if ($form['form']->isValid()) {
            $em = $this->getDoctrine()->getManager();
            $application = $element->getApplication();
            $em->persist($application->setUpdated(new \DateTime('now')));
            $em->persist($element);
            $em->flush();

            $this->get('session')->getFlashBag()->set('success',
                'Your element has been saved.');

            return new Response('', 205);
        } else {
            return array(
                'form' => $form['form']->createView(),
                'theme' => $form['theme'],
                'formAction' => $this->generateUrl('mapbender_manager_element_update', array(
                    'slug' => $slug,
                    'id' => $id,
                )),
            );
        }
    }

    /**
     * Display and handle element access rights
     *
     * @ManagerRoute("/application/{slug}/element/{id}/security", requirements={"id" = "\d+"})
     * @Template("MapbenderManagerBundle:Element:security.html.twig")
     * @param Request $request
     * @param $slug string Application short name
     * @param $id int Element ID
     * @return array
     * @throws \Doctrine\DBAL\ConnectionException
     * @throws \Exception
     */
    public function securityAction(Request $request, $slug, $id)
    {
        /** @var EntityManager $entityManager */
        /** @var Element $element */
        $doctrine          = $this->getDoctrine();
        $entityManager     = $doctrine->getManager();
        $elementRepository = $doctrine->getRepository('MapbenderCoreBundle:Element');
        $element           = $elementRepository->find($id);

        if (!$element) {
            throw $this->createNotFoundException("The element with the id \"$id\" does not exist.");
        }

        $entityManager->detach($element); // prevent element from being stored with default config/stored again

        /** @var Form $form */
        /** @var Form $aclForm */
        /** @var Connection  */
        $application = $this->getMapbender()->getApplicationEntity($slug);
        $connection  = $entityManager->getConnection();
        $formFactory = $this->getFormFactory();
        $formArray = $formFactory->getSecurityForm($element);
        $form = $formArray['form'];

        $aclForm     = $form->get('acl');

        if ($request->getMethod() === 'POST' && $form->submit($request)->isValid()) {
            $connection->beginTransaction();
            try {
                $aclManager  = $this->get('fom.acl.manager');
                $application->setUpdated(new \DateTime('now'));
                $entityManager->persist($application);
                $aclManager->setObjectACLFromForm($element, $aclForm, 'object');
                $entityManager->flush();
                $connection->commit();
                $this->get('session')->getFlashBag()->set('success', "Your element's access has been changed.");
            } catch (\Exception $e) {
                $this->get('session')->getFlashBag()->set('error', "There was an error trying to change your element's access.");
                $connection->rollBack();
                $entityManager->close();
                if ($this->container->getParameter('kernel.debug')) {
                    throw($e);
                }
            }
        }

        $response["form"] = $form->createView();
        return $response;
    }

    /**
     * Shows delete confirmation page
     *
     * @ManagerRoute("application/{slug}/element/{id}/delete", requirements = {
     *     "id" = "\d+" })
     * @Method("GET")
     * @Template("MapbenderManagerBundle:Element:delete.html.twig")
     */
    public function confirmDeleteAction($slug, $id)
    {
        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->find($id);

        if (!$element) {
            throw $this->createNotFoundException('The element with the id "'
                . $id . '" does not exist.');
        }

        return array(
            'element' => $element,
            'form' => $this->createDeleteForm($id)->createView());
    }

    /**
     * Delete element
     *
     * @ManagerRoute("application/{slug}/element/{id}/delete")
     * @Method("POST")
     */
    public function deleteAction($slug, $id)
    {
        $application = $this->getMapbender()->getApplicationEntity($slug);

        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->find($id);

        if (!$element) {
            throw $this->createNotFoundException('The element with the id "'
                . $id . '" does not exist.');
        }

        /** @var EntityManager $em */
        $em = $this->getDoctrine()->getManager();
        $query = $em->createQuery(
            "SELECT e FROM MapbenderCoreBundle:Element e"
            . " WHERE e.region=:reg AND e.application=:app"
            . " AND e.weight>=:min ORDER BY e.weight ASC");
        $query->setParameters(array(
            "reg" => $element->getRegion(),
            "app" => $element->getApplication()->getId(),
            "min" => $element->getWeight()));
        $elements = $query->getResult();
        foreach ($elements as $elm) {
            if ($elm->getId() !== $element->getId()) {
                $elm->setWeight($elm->getWeight() - 1);
            }
        }
        foreach ($elements as $elm) {
            $em->persist($elm);
        }
        $em->remove($element);
        $em->persist($application->setUpdated(new \DateTime('now')));
        $em->flush();

        $this->get('session')->getFlashBag()->set('success',
            'Your element has been removed.');

        return new Response();
    }

    /**
     * Delete element
     *
     * @ManagerRoute("application/element/{id}/weight")
     * @Method("POST")
     * @param Request $request
     * @param string $id
     * @return Response
     */
    public function weightAction(Request $request, $id)
    {
        /** @var Element $element */
        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->findOneBy(array('id' => $id));
        $em = $this->getDoctrine()->getManager();

        if (!$element) {
            throw $this->createNotFoundException('The element with the id "'
                . $id . '" does not exist.');
        }
        $number = intval($request->get("number"));
        $targetRegionName = $request->get("region");
        if ($number === $element->getWeight() && $element->getRegion() === $targetRegionName) {
            return new JsonResponse(array(
                'error' => '',      // why?
                'result' => 'ok',   // why?
            ));
        }
        $application = $element->getApplication();
        $currentRegionName = $element->getRegion();
        $affectedRegionNames = array(
            $currentRegionName,
            $targetRegionName,
        );

        /** @var ArrayCollection[]|Element[][] $partitions */
        $partitions = $application->getElements()->partition(function($_, $entity) use ($affectedRegionNames) {
            /** @var Element $entity */
            return in_array($entity->getRegion(), $affectedRegionNames, true);
        });
        $affectedRegions = $partitions[0];
        $unaffectedRegions = $partitions[1];
        if ($currentRegionName === $targetRegionName) {
            WeightSortedCollectionUtil::updateSingleWeight($affectedRegions, $element, $number);
        } else {
            $partitions = $affectedRegions->partition(function($_, $entity) use ($targetRegionName) {
                /** @var Element $entity */
                return $entity->getRegion() === $targetRegionName;
            });
            // move from current region to target region, reassign weights in both
            WeightSortedCollectionUtil::moveBetweenCollections($partitions[0], $partitions[1], $element, $number);
            $element->setRegion($targetRegionName);
        }
        $rebuiltElementCollection = $unaffectedRegions;
        foreach ($affectedRegions as $elementToReAdd) {
            $rebuiltElementCollection->add($elementToReAdd);
        }
        $application->setElements($unaffectedRegions);
        $application->setUpdated(new \DateTime());
        $em->persist($application);
        $em->flush();
        return new JsonResponse(array(
            'error' => '',      // why?
            'result' => 'ok',   // why?
        ));
    }

    /**
     * Delete element
     *
     * @ManagerRoute("application/element/{id}/enable")
     * @Method("POST")
     * @param Request $request
     * @param string $id
     * @return Response
     */
    public function enableAction(Request $request, $id)
    {
        $element = $this->getDoctrine()
            ->getRepository('MapbenderCoreBundle:Element')
            ->find($id);

        $enabled = $request->get("enabled");
        if (!$element) {
            return new JsonResponse(array(
                /** @todo: use http status codes to communicate error conditions */
                'error' => 'An element with the id "' . $id . '" does not exist.',
            ));

        } else {
            $enabled_before = $element->getEnabled();
            $enabled = $enabled === "true" ? true : false;
            $element->setEnabled($enabled);
            $em = $this->getDoctrine()->getManager();
            $em->persist($element->getApplication()->setUpdated(new \DateTime('now')));
            $em->persist($element);
            $em->flush();
            return new JsonResponse(array(
                'success' => array(         // why?
                    "id" => $element->getId(),
                    "type" => "element",
                    "enabled" => array(
                        'before' => $enabled_before,
                        'after' => $enabled,
                    ),
                ),
            ));
        }
    }

    /**
     * Creates the form for the delete confirmation page
     */
    private function createDeleteForm($id)
    {
        return $this->createFormBuilder(array('id' => $id))
                ->add('id', 'hidden')
                ->getForm();
    }

    /**
     * Get Mapbender core service
     * @return Mapbender
     */
    protected function getMapbender()
    {
        /** @var Mapbender $service */
        $service = $this->get('mapbender');
        return $service;
    }

    /**
     * @return ElementFactory
     */
    protected function getFactory()
    {
        /** @var ElementFactory $service */
        $service = $this->get('mapbender.element_factory.service');
        return $service;
    }

    /**
     * @return ElementFormFactory
     */
    protected function getFormFactory()
    {
        /** @var ElementFormFactory $service */
        $service = $this->get('mapbender.manager.element_form_factory.service');
        return $service;
    }
}
