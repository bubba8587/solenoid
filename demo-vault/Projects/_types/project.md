---
kind: mdbase.type
name: project
match:
  path_glob: "*.md"
schema:
  value:
    type: object
    properties:
      status:
        type: string
        enum: [planning, active, blocked, done]
      priority:
        type: integer
        minimum: 1
        maximum: 5
      budget:
        type: number
      due:
        type: string
        format: date
      lead:
        type: string
      tags:
        type: array
        items:
          type: string
      milestones:
        type: array
        items:
          type: object
          properties:
            name:
              type: string
            due:
              type: string
              format: date
            done:
              type: boolean
    required: [status, priority]
---
# Project

The shape every note in the Projects collection follows: `status` is one of planning,
active, blocked, or done; `priority` an integer 1–5; `budget` a number; `due` a date;
`tags` a list; and `milestones` a small table of name, due, and done. New project notes
are validated against this.
