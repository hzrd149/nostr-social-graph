mod support;

use nostr_social_graph::SocialGraph;
use support::*;

#[test]
fn size_reports_reachable_users_edges_and_distance_buckets() {
    let mut graph = SocialGraph::new(ADAM);
    graph.handle_event(&event(ADAM, 3, 1_000, vec![FIATJAF, SNOWDEN]), true, 1.0);
    graph.handle_event(&event(ADAM, 10_000, 1_001, vec![CHARLIE]), true, 1.0);
    graph.handle_event(&event(FIATJAF, 3, 1_002, vec![SIRIUS]), true, 1.0);

    let stats = graph.size();

    assert_eq!(stats.users, 4);
    assert_eq!(stats.follows, 3);
    assert_eq!(stats.mutes, 1);
    assert_eq!(stats.size_by_distance.get(&0), Some(&1));
    assert_eq!(stats.size_by_distance.get(&1), Some(&2));
    assert_eq!(stats.size_by_distance.get(&2), Some(&1));
}

#[test]
fn users_are_returned_in_distance_order() {
    let mut graph = SocialGraph::new(ADAM);
    graph.handle_event(&event(ADAM, 3, 1_000, vec![FIATJAF, SNOWDEN]), true, 1.0);
    graph.handle_event(&event(FIATJAF, 3, 1_001, vec![SIRIUS]), true, 1.0);

    assert_eq!(
        graph.get_users_by_follow_distance(1),
        vec![FIATJAF.to_string(), SNOWDEN.to_string()]
    );
    assert_eq!(
        graph.users_in_distance_order(Some(1)),
        vec![ADAM.to_string(), FIATJAF.to_string(), SNOWDEN.to_string()]
    );
    assert_eq!(
        graph.users_in_distance_order(None),
        vec![
            ADAM.to_string(),
            FIATJAF.to_string(),
            SNOWDEN.to_string(),
            SIRIUS.to_string()
        ]
    );
}
