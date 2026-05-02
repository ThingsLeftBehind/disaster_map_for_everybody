import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/list',
      permanent: false,
    },
  };
};

export default function SheltersIndexRedirect() {
  return null;
}
