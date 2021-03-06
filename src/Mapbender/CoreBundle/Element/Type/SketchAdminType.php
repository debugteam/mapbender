<?php

namespace Mapbender\CoreBundle\Element\Type;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\OptionsResolver\OptionsResolver;

class SketchAdminType extends AbstractType
{
    /**
     * @inheritdoc
     */
    public function configureOptions(OptionsResolver $resolver)
    {
        $resolver->setDefaults(array(
            'application' => null,
        ));
    }

    /**
     * @inheritdoc
     */
    public function buildForm(FormBuilderInterface $builder, array $options)
    {
        $builder
            ->add('target', 'Mapbender\CoreBundle\Element\Type\TargetElementType', array(
                'element_class' => 'Mapbender\\CoreBundle\\Element\\Map',
                'application' => $options['application'],
                'required' => false,
            ))
            ->add('auto_activate', 'Symfony\Component\Form\Extension\Core\Type\CheckboxType', array(
                'required' => false,
                'label' => 'mb.core.sketch.admin.auto_activate',
            ))
            ->add('deactivate_on_close', 'Symfony\Component\Form\Extension\Core\Type\CheckboxType', array(
                'required' => false,
                'label' => 'mb.core.sketch.admin.deactivate_on_close',
            ))
            ->add('geometrytypes', 'Symfony\Component\Form\Extension\Core\Type\ChoiceType', array(
                'required' => true,
                'multiple' => true,
                'choices' => array(
                    'mb.core.sketch.geometrytype.point' => 'point',
                    'mb.core.sketch.geometrytype.line' => 'line',
                    'mb.core.sketch.geometrytype.polygon' => 'polygon',
                    'mb.core.sketch.geometrytype.rectangle' => 'rectangle',
                    'mb.core.sketch.geometrytype.circle' => 'circle',
                    'mb.core.sketch.geometrytype.text' => 'text',
                ),
                'choices_as_values' => true,
            ))
        ;
    }
}
