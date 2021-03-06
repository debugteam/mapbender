<?php

namespace Mapbender\WmtsBundle\Form\Type;

use Mapbender\WmtsBundle\Entity\WmtsInstanceLayer;
use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\FormBuilderInterface;
use Mapbender\WmtsBundle\Form\EventListener\FieldSubscriber;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\Form\FormView;

/**
 * @author Paul Schmidt
 */
class WmtsInstanceLayerType extends AbstractType
{

    public function getParent()
    {
        return 'Mapbender\ManagerBundle\Form\Type\SourceInstanceItemType';
    }

    /**
     * @inheritdoc
     */
    public function buildForm(FormBuilderInterface $builder, array $options)
    {
        $subscriber = new FieldSubscriber();
        $builder->addEventSubscriber($subscriber);
        $builder
            ->add('info', 'Symfony\Component\Form\Extension\Core\Type\CheckboxType', array(
                'required' => false,
                'label' => 'mb.wms.wmsloader.repo.instancelayerform.label.infotoc',
            ))
            ->add('allowinfo', 'Symfony\Component\Form\Extension\Core\Type\CheckboxType', array(
                'required' => false,
                'label' => 'mb.wms.wmsloader.repo.instancelayerform.label.allowinfotoc',
            ))
        ;
    }

    public function finishView(FormView $view, FormInterface $form, array $options)
    {
        // NOTE: collection prototype view does not have data
        /** @var WmtsInstanceLayer|null $layer */
        $layer = $form->getData();
        if ($layer) {
            $isQueryable = !!$layer->getSourceItem()->getInfoformats();
        } else {
            $isQueryable = false;
        }
        $view['info']->vars['disabled'] = !$isQueryable;
        $view['allowinfo']->vars['disabled'] = !$isQueryable;
        if (!$isQueryable) {
            $form['info']->setData(false);
            $form['allowinfo']->setData(false);
        }
        $view['info']->vars['checkbox_group'] = 'checkInfoOn';
        $view['allowinfo']->vars['checkbox_group'] = 'checkInfoAllow';
    }
}
