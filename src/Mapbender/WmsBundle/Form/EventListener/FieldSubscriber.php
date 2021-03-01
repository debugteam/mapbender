<?php

namespace Mapbender\WmsBundle\Form\EventListener;

use Mapbender\WmsBundle\Entity\WmsInstanceLayer;
use Symfony\Component\Form\FormEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\Form\FormEvents;

class FieldSubscriber implements EventSubscriberInterface
{
    /**
     * Returns defined events
     *
     * @return array events
     */
    public static function getSubscribedEvents()
    {
        return array(FormEvents::PRE_SET_DATA => 'preSetData');
    }

    /**
     * Presets a form data
     *
     * @param FormEvent $event
     */
    public function preSetData(FormEvent $event)
    {
        /** @var WmsInstanceLayer $data */
        $data = $event->getData();
        $form = $event->getForm();

        if (null === $data) {
            return;
        }

        $arrStyles = $data->getSourceItem()->getStyles(true);
        $styleOpt = array(" " => "");
        foreach ($arrStyles as $style) {
            if(strtolower($style->getName()) !== 'default'){ // accords with WMS Implementation Specification
                $styleOpt[$style->getTitle()] = $style->getName();
            }
        }

        $form->remove('style');
        $form
            ->add('style', 'Mapbender\CoreBundle\Form\Type\InstanceLayerStyleChoiceType', array(
                'label' => 'Style',
                'layer' => $event->getData(),
                'choices' => $styleOpt,
                'required' => false,
            ))
        ;
    }
}
