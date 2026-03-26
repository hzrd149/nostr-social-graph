#!/usr/bin/env perl

use strict;
use warnings;
use File::stat;
use JSON::PP qw(decode_json encode_json);

$| = 1;

my $allowlist_path = $ENV{GRAPH_RELAY_ALLOWLIST_PATH}
  or die "GRAPH_RELAY_ALLOWLIST_PATH is required\n";
my $ingest_ip = $ENV{GRAPH_RELAY_INGEST_IP} // '';
my %allowed_kinds = map { $_ => 1 } (0, 3, 10000);
my %allowed_pubkeys = ();
my $loaded_mtime = -1;

sub reload_allowlist {
    my $stat = stat($allowlist_path);
    if (!$stat) {
        %allowed_pubkeys = ();
        $loaded_mtime = -1;
        return;
    }

    my $mtime = $stat->mtime;
    return if $mtime == $loaded_mtime;

    open my $fh, '<', $allowlist_path or do {
        %allowed_pubkeys = ();
        $loaded_mtime = -1;
        return;
    };

    my %next = ();
    while (my $line = <$fh>) {
        chomp $line;
        $line =~ s/^\s+|\s+$//g;
        next if $line eq '';
        $next{lc $line} = 1;
    }
    close $fh;

    %allowed_pubkeys = %next;
    $loaded_mtime = $mtime;
}

while (my $line = <STDIN>) {
    chomp $line;
    next if $line eq '';

    my $req = eval { decode_json($line) };
    next if $@ || ref $req ne 'HASH';
    next if ($req->{type} // '') ne 'new';

    reload_allowlist();

    my $event = $req->{event} || {};
    my $id = $event->{id} // '';
    my $kind = $event->{kind};
    my $pubkey = lc($event->{pubkey} // '');
    my $source_type = $req->{sourceType} // '';
    my $source_info = $req->{sourceInfo} // '';

    my %response = (id => $id);

    if (!defined $kind || !$allowed_kinds{$kind}) {
        $response{action} = 'reject';
        $response{msg} = 'blocked: unsupported kind';
    } elsif (!$allowed_pubkeys{$pubkey}) {
        $response{action} = 'reject';
        $response{msg} = 'blocked: author outside graph';
    } elsif (
        $source_type ne 'IP4'
        && $source_type ne 'IP6'
    ) {
        $response{action} = 'reject';
        $response{msg} = 'blocked: read-only mirror';
    } elsif ($ingest_ip ne '' && $source_info ne $ingest_ip) {
        $response{action} = 'reject';
        $response{msg} = 'blocked: read-only mirror';
    } else {
        $response{action} = 'accept';
    }

    print encode_json(\%response) . "\n";
}
