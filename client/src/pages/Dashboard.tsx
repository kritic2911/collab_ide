import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '../ui/Shell';
import { colors, cardStyle, buttonBase } from '../ui/styles';
import { fetchRepos, ConnectedRepo } from '../api/admin';
import { useRepoStore } from '../store/repoStore';

export default function Dashboard() {
  const { repos, setRepos } = useRepoStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRepos()
      .then((data) => {
        if (cancelled) return;
        setRepos(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load repos');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setRepos]);

  const connected = useMemo(() => repos ?? [], [repos]);

  return (
    <Shell title="Dashboard">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>Your available repos</div>
          <div style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
            These are the repos the admin connected and you’re allowed to access.
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ ...buttonBase, fontSize: 13 }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(248, 81, 73, 0.4)',
            background: 'rgba(248, 81, 73, 0.08)',
            color: colors.danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {loading ? (
          <RepoCardSkeleton />
        ) : connected.length === 0 ? (
          <div style={{ ...cardStyle, color: colors.muted }}>
            No repos available yet. Ask your admin to connect a GitHub repo in the Admin dashboard.
          </div>
        ) : (
          connected.map((r) => <RepoCard key={r.id} repo={r} />)
        )}
      </div>
    </Shell>
  );
}

function RepoCard({ repo }: { repo: ConnectedRepo }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {repo.owner}/{repo.name}
          </div>
          <div style={{ marginTop: 6, color: colors.muted, fontSize: 13 }}>
            Default branch: <span style={{ color: colors.text }}>{repo.default_branch}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Link
            to={`/browse/${repo.id}`}
            style={{
              ...buttonBase,
              textDecoration: 'none',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            Browse
          </Link>
          <Link
            to={`/ide/${repo.id}`}
            style={{
              ...buttonBase,
              textDecoration: 'none',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            IDE
          </Link>
        </div>
      </div>
    </div>
  );
}

function RepoCardSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            ...cardStyle,
            borderStyle: 'dashed',
            color: colors.muted,
          }}
        >
          Loading…
        </div>
      ))}
    </>
  );
}

