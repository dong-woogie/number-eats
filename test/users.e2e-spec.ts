import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnection, Repository } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { User } from 'src/users/entities/user.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Verification } from 'src/users/entities/verification.entity';

jest.mock('got', () => ({
  post: jest.fn(),
}));

const GRAPHQL_END_POINT = '/graphql';

describe('UserModule E2E', () => {
  let app: INestApplication;
  let token: string;
  let userRepository: Repository<User>;
  let verificationRepository: Repository<Verification>;

  const EMAIL = 'test@co.kr';
  const PASSWORD = 'test123';

  let baseRequest;
  let publicRequest;
  let privateRequest;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    verificationRepository = module.get<Repository<Verification>>(
      getRepositoryToken(Verification),
    );
    await app.init();

    baseRequest = request(app.getHttpServer()).post(GRAPHQL_END_POINT);
    publicRequest = (query: string) => baseRequest.send({ query });
    privateRequest = (query: string) =>
      baseRequest.set('x-jwt', token).send({ query });
  });

  afterAll(async () => {
    await getConnection().dropDatabase();
    await app.close();
  });

  describe('createAccount', () => {
    it('should create account', () => {
      return publicRequest(`
          mutation {
            createAccount(input:{
              email : "${EMAIL}",
              password : "${PASSWORD}",
              role : Client
            }) {
              ok
              error
            }
          }
        `)
        .expect(200)
        .expect(res => {
          expect(res.body.data.createAccount.ok).toBe(true);
          expect(res.body.data.createAccount.error).toBe(null);
        });
    });

    it('should fail if account already exists', () => {
      return publicRequest(`
          mutation {
            createAccount(input:{
              email : "${EMAIL}",
              password : "${PASSWORD}",
              role : Client
            }) {
              ok
              error
            }
          }
        `)
        .expect(200)
        .expect(res => {
          expect(res.body.data.createAccount.ok).toBe(false);
          expect(res.body.data.createAccount.error).toBe('exist user');
        });
    });
  });

  describe('login', () => {
    it('should login with correct credentials', () => {
      return publicRequest(`
          mutation{
            login (input:{
              email : "${EMAIL}",
              password : "${PASSWORD}"
            }){
              ok,
              error,
              token
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: { login },
            },
          } = res;
          token = login.token;
          expect(login.ok).toBe(true);
          expect(login.error).toBe(null);
          expect(login.token).toEqual(expect.any(String));
        });
    });

    it('should fail if the password is wrong', () => {
      return publicRequest(`
          mutation{
            login (input:{
              email : "${EMAIL}",
              password : "WRONG PASSWORD"
            }){
              ok,
              error,
              token
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: { login },
            },
          } = res;
          expect(login.ok).toBe(false);
          expect(login.error).toBe('Wrong password');
          expect(login.token).toBe(null);
        });
    });

    it('should fail if the user not found ', () => {
      return publicRequest(`
          mutation{
            login (input:{
              email : "NOT EXIST EMAIL",
              password : "${PASSWORD}"
            }){
              ok,
              error,
              token
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: { login },
            },
          } = res;
          expect(login.ok).toBe(false);
          expect(login.error).toBe('Not Found User');
          expect(login.token).toBe(null);
        });
    });
  });

  describe('userProfile', () => {
    //
    const userId = 1;
    it("should see user's profile", async () => {
      return privateRequest(`
        {
          userProfile (userId : ${userId}){
            ok
            error
            user {
              id
            }
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: {
                userProfile: { ok, error, user },
              },
            },
          } = res;
          expect(ok).toBe(true);
          expect(error).toBe(null);
          expect(user.id).toBe(userId);
        });
    });

    it('should not found a profile', async () => {
      return privateRequest(`
        {
          userProfile (userId :2){
            ok
            error
            user {
              id
            }
          }
        }
      `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: {
                userProfile: { ok, error, user },
              },
            },
          } = res;
          expect(ok).toBe(false);
          expect(error).toBe('Not Found User');
          expect(user).toBe(null);
        });
    });
  });

  describe('me', () => {
    it('should find my profile', () => {
      return privateRequest(`
          {
            me {
              email
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: { me },
            },
          } = res;
          expect(me.email).toBe(EMAIL);
        });
    });

    it('should not allow logged out user', () => {
      return publicRequest(`
          {
            me {
              email
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: { errors },
          } = res;
          const [error] = errors;
          expect(error.message).toBe('Forbidden resource');
        });
    });
  });

  describe('editProfile', () => {
    const NEW_EMAIL = 'newEmail';
    it('should change email', () => {
      return privateRequest(`
          mutation {
            editProfile(input : {
              email : "${NEW_EMAIL}"
            }) {
              ok
              error
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const {
            body: {
              data: {
                editProfile: { ok, error },
              },
            },
          } = res;

          expect(ok).toBe(true);
          expect(error).toBe(null);
        });
    });

    it('should have new email', () => {
      return privateRequest(`
            {
              me {
                email
              }
            }
          `)
        .expect(200)
        .expect(res => {
          const { email } = res?.body?.data?.me;
          expect(email).toBe(NEW_EMAIL);
        });
    });
  });

  describe('verifyEmail', () => {
    let userId: number;
    beforeAll(async () => {
      const [user] = await userRepository.find();
      userId = user.id;
    });

    it('should verify email', async () => {
      const { code } = await verificationRepository.findOne({
        user: { id: userId },
      });
      return publicRequest(`
          mutation {
            verifyEmail(input:{
              code : "${code}"
            }){
              ok,
              error
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const { ok, error } = res?.body?.data?.verifyEmail;

          expect(ok).toBe(true);
          expect(error).toBe(null);
        });
    });

    it('should fail on wrong verify code', async () => {
      return publicRequest(`
          mutation {
            verifyEmail(input:{
              code : "wrong code"
            }){
              ok,
              error
            }
          }
        `)
        .expect(200)
        .expect(res => {
          const { ok, error } = res?.body?.data?.verifyEmail;

          expect(ok).toBe(false);
          expect(error).toBe('Verification Not Found');
        });
    });
  });
});
