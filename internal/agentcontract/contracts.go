package agentcontract

import "time"

type ActorKind string

const (
	ActorHuman ActorKind = "human"
	ActorAgent ActorKind = "agent"
)

func (kind ActorKind) Valid() bool {
	return kind == ActorHuman || kind == ActorAgent
}

type ActorRef struct {
	ID    string    `json:"id"`
	Kind  ActorKind `json:"kind"`
	Label string    `json:"label"`
}

type Partition string

const (
	PartitionRequirements Partition = "requirements"
	PartitionDevelopment  Partition = "development"
	PartitionStable       Partition = "stable"
)

func (partition Partition) Valid() bool {
	switch partition {
	case PartitionRequirements, PartitionDevelopment, PartitionStable:
		return true
	default:
		return false
	}
}

type CommandEnvelope struct {
	Actor            ActorRef
	Partition        Partition
	IdempotencyKey   string
	ExpectedRevision uint64
}

// ChangeSetMetadata fixes the server-owned shape used by the later review gate.
// Phase D does not persist changesets or accept these fields from clients.
type ChangeSetMetadata struct {
	ID             string    `json:"id"`
	Author         ActorRef  `json:"author"`
	Partition      Partition `json:"partition"`
	IdempotencyKey string    `json:"idempotencyKey"`
	BaseRevision   uint64    `json:"baseRevision"`
	ResultRevision uint64    `json:"resultRevision"`
	CreatedAt      time.Time `json:"createdAt"`
}
