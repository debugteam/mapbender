<?php
namespace Mapbender\ManagerBundle\Form\Type;

use Mapbender\CoreBundle\Component\Template;
use Mapbender\CoreBundle\Entity\Application;
use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\OptionsResolver\OptionsResolver;
use Symfony\Component\Validator\Constraints;


class ApplicationType extends AbstractType
{

    public function getName()
    {
        return 'application';
    }

    public function configureOptions(OptionsResolver $resolver)
    {
        $resolver->setDefaults(array(
            'available_templates' => array(),
            'maxFileSize' => 0,
            'screenshotHeight' => 0,
            'screenshotWidth' => 0
        ));
    }

    public function buildForm(FormBuilderInterface $builder, array $options)
    {
        $builder
            ->add('title', 'text', array(
                'label' => 'mb.manager.admin.application.title',
                'attr' => array(
                    'title' => 'The application title, as shown in the browser '
                    . 'title bar and in lists.',
                ),
            ))
            ->add('slug', 'text', array(
                'label' => 'mb.manager.admin.application.url.title',
                'attr' => array(
                    'title' => 'The URL title (slug) is based on the title and used in the '
                    . 'application URL.',
                ),
            ))
            ->add('description', 'textarea', array(
                'required' => false,
                'label' => 'mb.manager.admin.application.description',
                'attr' => array(
                    'title' => 'The description is used in overview lists.',
                ),
            ))
            ->add('template', 'choice', array(
                'choices' => $options['available_templates'],
                'label' => 'mb.manager.admin.application.template',
                'label_attr' => array(
                    'title' => 'The HTML template used for this application.',
                ),
            ))
            ->add('screenshotFile', 'file', array(
                'label' => 'Screenshot',
                'mapped' => false,
                'required' => false,
                'attr' => array(
                    'accept'=>'image/*',
                ),
                'constraints' => array(
                    new Constraints\Image(array(
                        'maxSize' => '2M',
                        'mimeTypesMessage' => 'mb.core.entity.app.screenshotfile.format_error',
                    )),
                ),
            ))
            ->add('removeScreenShot', 'hidden',array(
                'mapped' => false,
            ))
            ->add('uploadScreenShot', 'hidden',array(
                'mapped' => false,
            ))
            ->add('maxFileSize', 'hidden',array(
                'mapped' => false,
                'data' => $options['maxFileSize'],
            ))
            ->add('screenshotWidth', 'hidden',array(
                'mapped' => false,
                'data' => $options['screenshotWidth'],
            ))
            ->add('screenshotHeight', 'hidden',array(
                'mapped' => false,
                'data' => $options['screenshotHeight'],
            ))
            ->add('custom_css', 'textarea', array(
                'required' => false,
            ))
            ->add('published', 'checkbox',
                array(
                'required' => false,
                'label' => 'mb.manager.admin.application.security.public',
            ))
        ;
        /** @var Application $application */
        $application = $options['data'];
        $templateClassName = $application->getTemplate();
        if ($templateClassName) {
            /** @var Template::class $templateClassName */
            foreach (array_keys($templateClassName::getRegionsProperties()) as $regionName) {
                $builder->add($regionName, 'region_properties', array(
                    'property_path' => '[' . $regionName . ']',
                    'application' => $options['data'],
                    'region' => $regionName,
                ));
            }
        }

        // Security
        $builder->add('acl', 'acl', array(
            'mapped' => false,
            'data' => $options['data'],
            'permissions' => 'standard::object'));
    }
}
