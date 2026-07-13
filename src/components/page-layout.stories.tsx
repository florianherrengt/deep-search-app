import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Paper, Stack, Text } from "@mantine/core";
import { PageHeader, PageLayout } from "./page-layout";

const meta = {
  title: "Layout/PageLayout",
  component: PageLayout,
  parameters: { layout: "fullscreen" },
  args: {
    children: (
      <Stack gap="lg">
        <PageHeader
          title="Research library"
          description="Review saved searches and manage reusable research resources."
          action={<Button variant="light">New resource</Button>}
        />
        <Paper withBorder p="lg">
          <Text size="sm">Page content uses one responsive width and spacing rhythm.</Text>
        </Paper>
      </Stack>
    ),
  },
} satisfies Meta<typeof PageLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
