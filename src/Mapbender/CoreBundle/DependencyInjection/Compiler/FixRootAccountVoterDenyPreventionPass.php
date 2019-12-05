<?php


namespace Mapbender\CoreBundle\DependencyInjection\Compiler;


use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\Security\Core\Authorization\AccessDecisionManager;

/**
 * Change access decision manager strategy to consensus to prevent FOM root account voter from
 * nonchalantly allowing explicitly denied grants.
 * @see \FOM\UserBundle\Security\Authorization\Voter\RootAccountVoter
 * @see AccessDecisionManager::decideConsensus
 */
class FixRootAccountVoterDenyPreventionPass implements CompilerPassInterface
{
    public function process(ContainerBuilder $container)
    {
        $definition = $container->getDefinition('security.access.decision_manager');
        /** @see AccessDecisionManager::__construct */
        $arguments = $definition->getArguments();
        $arguments[1] = AccessDecisionManager::STRATEGY_CONSENSUS;
        $definition->setArguments($arguments);
    }
}
